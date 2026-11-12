'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const JSZip = require('jszip');

const ARCHIVE_PREFIX = 'BRITECH2:';
const CREDS_PREFIX = 'BRITECH:~';
const ARCHIVE_ROOT = 'session/auth/';

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

module.exports = { ARCHIVE_PREFIX, CREDS_PREFIX, extractAuthArchive, hydrateSessionId };
