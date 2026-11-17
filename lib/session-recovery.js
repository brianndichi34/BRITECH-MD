'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const RECOVERY_WINDOW_MS = 60_000;
const MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isBadMacError(value) {
  const text = typeof value === 'string' ? value : safeStringify(value);
  return /bad\s*mac|no matching sessions found|sessioncipher\.decryptwithsession/i.test(text);
}

function safeStringify(value) {
  try {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    return typeof value === 'string' ? value : JSON.stringify(value, (_key, nested) => {
      if (nested instanceof Error) return `${nested.name}: ${nested.message}`;
      return nested;
    });
  } catch {
    return String(value);
  }
}

async function isRegisteredAuth(dir) {
  try {
    const raw = await fs.readFile(path.join(dir, 'creds.json'), 'utf8');
    const creds = JSON.parse(raw);
    return Boolean(creds && creds.registered && creds.me?.id);
  } catch {
    return false;
  }
}

async function findAuthSource(candidate) {
  if (await isRegisteredAuth(candidate)) return candidate;
  const nested = path.join(candidate, 'auth');
  if (await isRegisteredAuth(nested)) return nested;
  return null;
}

async function listRecoveryCandidates(sessionParent, activeName = 'auth') {
  const entries = await fs.readdir(sessionParent, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === activeName || entry.name.startsWith('auth.badmac-recovery-') || !/^auth(?:[.-])/.test(entry.name)) continue;
    const candidate = path.join(sessionParent, entry.name);
    const source = await findAuthSource(candidate);
    if (!source) continue;
    const stat = await fs.stat(source);
    candidates.push({ name: entry.name, source, mtimeMs: stat.mtimeMs });
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function readMarker(markerPath) {
  try {
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    if (Date.now() - Number(marker.attemptedAt || 0) < MARKER_MAX_AGE_MS) return marker;
  } catch {}
  return null;
}

async function recoverFromBackup({ sessionDir, logger = console, now = Date.now() }) {
  const active = path.resolve(sessionDir);
  const parent = path.dirname(active);
  const activeName = path.basename(active);
  const markerPath = path.join(parent, '.badmac-recovery.json');
  const previous = await readMarker(markerPath);
  const candidates = await listRecoveryCandidates(parent, activeName);
  const candidate = candidates.find(item => !previous || item.name !== previous.candidate);
  if (!candidate) {
    logger.warn?.('Bad MAC recovery found no unused validated auth backup; a fresh WhatsApp session is required.');
    return { recovered: false, reason: 'no-unused-validated-backup', candidates: candidates.map(item => item.name) };
  }

  const preserved = path.join(parent, `auth.badmac-recovery-${new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}Z`);
  await fs.rename(active, preserved);
  try {
    await fs.rename(candidate.source, active);
  } catch (error) {
    await fs.rename(preserved, active).catch(() => {});
    throw error;
  }
  await fs.writeFile(markerPath, JSON.stringify({ attemptedAt: now, candidate: candidate.name, preserved }, null, 2) + '\n', { mode: 0o600 });
  logger.warn?.({ candidate: candidate.name, preserved }, 'Bad MAC recovery rotated to a validated auth backup; restarting once.');
  return { recovered: true, candidate: candidate.name, preserved, markerPath };
}

function createBadMacRecovery({ sessionDir, threshold = 3, windowMs = RECOVERY_WINDOW_MS, onRecovered, logger = console }) {
  let count = 0;
  let firstAt = 0;
  let triggered = false;
  let timer;

  function observe(value) {
    if (triggered || !isBadMacError(value)) return false;
    const now = Date.now();
    if (!firstAt || now - firstAt > windowMs) {
      firstAt = now;
      count = 0;
    }
    count += 1;
    if (count < threshold) return false;
    triggered = true;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const result = await recoverFromBackup({ sessionDir, logger });
        if (result.recovered) await onRecovered?.(result);
      } catch (error) {
        logger.error?.({ err: error?.message || error }, 'Bad MAC recovery failed without deleting the active session.');
      }
    }, 0);
    return true;
  }

  return { observe, getState: () => ({ count, firstAt, triggered }) };
}

module.exports = { isBadMacError, isRegisteredAuth, listRecoveryCandidates, recoverFromBackup, createBadMacRecovery };
