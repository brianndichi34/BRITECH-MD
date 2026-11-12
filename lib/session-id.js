'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const JSZip = require('jszip');

const ARCHIVE_PREFIX = 'BRITECH2:';
const CREDS_PREFIX = 'BRITECH:~';
const COMPACT_PREFIX = 'BRITECH3:';
const ARCHIVE_ROOT = 'session/auth/';
const MAX_COMPACT_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 10000;

function createCompactSessionId(files) {
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) {
    throw new Error('Invalid number of files for compact SESSION_ID.');
  }
  const normalized = files.map(file => {
    const relative = String(file.path || '').replace(/\\/g, '/');
    const clean = path.posix.normalize(relative);
    if (!relative || clean === '.' || clean === '..' || clean.startsWith('../') || clean.startsWith('/') || clean !== relative) {
      throw new Error('Auth archive contains an invalid relative path.');
    }
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    return { path: clean, data };
  });
  const manifest = Buffer.from(JSON.stringify(normalized.map(file => ({ path: file.path, size: file.data.length }))), 'utf8');
  if (manifest.length > 1024 * 1024) throw new Error('Auth archive manifest is too large.');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(manifest.length);
  const raw = Buffer.concat([header, manifest, ...normalized.map(file => file.data)]);
  if (raw.length > MAX_COMPACT_BYTES) throw new Error('WhatsApp auth data exceeds the maximum SESSION_ID archive size.');
  const compressed = zlib.brotliCompressSync(raw, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC
    }
  });
  return COMPACT_PREFIX + compressed.toString('base64url');
}

function decodeCompactSessionId(value) {
  const encoded = value.slice(COMPACT_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('SESSION_ID compact payload is malformed.');
  const compressed = Buffer.from(encoded, 'base64url');
  const raw = zlib.brotliDecompressSync(compressed, { maxOutputLength: MAX_COMPACT_BYTES });
  if (raw.length < 4) throw new Error('SESSION_ID compact payload is truncated.');
  const manifestLength = raw.readUInt32BE(0);
  if (!manifestLength || manifestLength > 1024 * 1024 || 4 + manifestLength > raw.length) throw new Error('SESSION_ID compact manifest is invalid.');
  const manifest = JSON.parse(raw.subarray(4, 4 + manifestLength).toString('utf8'));
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > MAX_FILES) throw new Error('SESSION_ID compact file list is invalid.');
  let offset = 4 + manifestLength;
  const seen = new Set();
  const files = manifest.map(entry => {
    if (!entry || typeof entry.path !== 'string' || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('SESSION_ID compact file entry is invalid.');
    const relative = entry.path.replace(/\\/g, '/');
    const clean = path.posix.normalize(relative);
    if (!relative || clean === '.' || clean === '..' || clean.startsWith('../') || clean.startsWith('/') || clean !== relative) throw new Error('SESSION_ID compact file path is unsafe.');
    if (seen.has(relative)) throw new Error('SESSION_ID compact archive contains a duplicate file path.');
    seen.add(relative);
    const end = offset + entry.size;
    if (end > raw.length) throw new Error('SESSION_ID compact file data is truncated.');
    const data = raw.subarray(offset, end);
    offset = end;
    return { relative, data };
  });
  if (offset !== raw.length) throw new Error('SESSION_ID compact payload contains unexpected trailing data.');
  const creds = files.find(file => file.relative === 'creds.json');
  if (!creds) throw new Error('SESSION_ID compact archive does not contain creds.json.');
  const credentials = JSON.parse(creds.data.toString('utf8'));
  if (!credentials.registered || !credentials.me?.id) throw new Error('SESSION_ID compact archive contains unregistered WhatsApp credentials.');
  return files;
}

function isZip(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

async function extractAuthArchive(archiveBuffer, sessionDir) {
  if (!isZip(archiveBuffer)) throw new Error('SESSION_ID archive payload is not a ZIP file.');
  const zip = await JSZip.loadAsync(archiveBuffer);
  const root = path.resolve(sessionDir);
  const extracted = [];

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const normalized = path.posix.normalize(name);
    if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../') || !normalized.startsWith(ARCHIVE_ROOT)) {
      throw new Error('SESSION_ID archive contains a path outside the auth folder.');
    }
    const relative = normalized.slice(ARCHIVE_ROOT.length);
    if (!relative || relative.split('/').some(part => part === '..' || part === '')) {
      throw new Error('SESSION_ID archive contains an invalid auth path.');
    }
    const permissions = typeof entry.unixPermissions === 'number' ? entry.unixPermissions : 0;
    if ((permissions & 0o170000) === 0o120000) throw new Error('SESSION_ID archive may not contain symbolic links.');

    const target = path.resolve(root, ...relative.split('/'));
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('SESSION_ID archive path escapes the auth folder.');
    if (fs.existsSync(target)) throw new Error('SESSION_ID import would overwrite existing auth data; clear or back up the folder first.');
    extracted.push({ target, relative, buffer: await entry.async('nodebuffer') });
  }

  const credsEntry = extracted.find(entry => entry.relative === 'creds.json');
  if (!credsEntry) throw new Error('SESSION_ID archive does not contain session/auth/creds.json.');
  const creds = JSON.parse(credsEntry.buffer.toString('utf8'));
  if (!creds.registered || !creds.me?.id) throw new Error('SESSION_ID archive contains unregistered WhatsApp credentials.');

  for (const entry of extracted) {
    fs.mkdirSync(path.dirname(entry.target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(entry.target, entry.buffer, { mode: 0o600, flag: 'wx' });
  }
  return extracted.length;
}

async function hydrateSessionId(sessionId, sessionDir) {
  const value = String(sessionId || '').trim();
  if (!value) return { loaded: false, reason: 'empty' };
  const root = path.resolve(sessionDir);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const credsPath = path.join(root, 'creds.json');
  if (fs.existsSync(credsPath)) return { loaded: false, reason: 'existing-session' };
  if (fs.readdirSync(root).length) throw new Error('SESSION_ID import stopped because the auth folder is not empty. Back it up or clear it before importing.');

  if (value.startsWith(COMPACT_PREFIX)) {
    const files = decodeCompactSessionId(value);
    for (const entry of files) {
      const target = path.resolve(root, ...entry.relative.split('/'));
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error('SESSION_ID compact path escapes the auth folder.');
    }
    for (const entry of files) {
      const target = path.resolve(root, ...entry.relative.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, entry.data, { mode: 0o600, flag: 'wx' });
    }
    return { loaded: true, files: files.length, format: 'BRITECH3' };
  }

  if (value.startsWith(ARCHIVE_PREFIX)) {
    const compressed = Buffer.from(value.slice(ARCHIVE_PREFIX.length), 'base64url');
    const archive = zlib.inflateRawSync(compressed);
    return { loaded: true, files: await extractAuthArchive(archive, root), format: 'BRITECH2' };
  }

  if (value.startsWith(CREDS_PREFIX)) {
    const raw = zlib.inflateSync(Buffer.from(value.slice(CREDS_PREFIX.length), 'base64'));
    const creds = JSON.parse(raw.toString('utf8'));
    if (!creds.registered || !creds.me?.id) throw new Error('SESSION_ID does not contain registered credentials.');
    fs.writeFileSync(credsPath, JSON.stringify(creds), { mode: 0o600, flag: 'wx' });
    return { loaded: true, files: 1, format: 'BRITECH:~' };
  }

  // Backward compatibility for older GitHub Actions IDs (base64 ZIP) and
  // the legacy uncompressed/compressed credential-only values.
  const legacy = Buffer.from(value, 'base64');
  if (isZip(legacy)) return { loaded: true, files: await extractAuthArchive(legacy, root), format: 'legacy-zip' };
  let raw;
  try { raw = zlib.inflateSync(legacy); } catch { raw = legacy; }
  const creds = JSON.parse(raw.toString('utf8'));
  if (!creds.registered || !creds.me?.id) throw new Error('SESSION_ID does not contain recognized registered credentials or an auth archive.');
  fs.writeFileSync(credsPath, JSON.stringify(creds), { mode: 0o600, flag: 'wx' });
  return { loaded: true, files: 1, format: 'legacy-creds' };
}

module.exports = { ARCHIVE_PREFIX, CREDS_PREFIX, COMPACT_PREFIX, createCompactSessionId, decodeCompactSessionId, extractAuthArchive, hydrateSessionId };
