const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const activeAttempts = new Map();
const DEFAULT_STATE_DIR = path.join(__dirname, '..', 'session');
const STALE_LOCK_MS = 5 * 60 * 1000;

function accountKey(jid) {
  const stableJid = String(jid).trim().replace(/:\d+(?=@)/, '');
  return crypto.createHash('sha256').update(stableJid).digest('hex');
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fs.open(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError.code === 'ENOENT') continue;
        throw statError;
      }
      return null;
    }
  }
  return null;
}

async function sendConnectionWelcome(sock, message, { stateDir = DEFAULT_STATE_DIR, logger = {} } = {}) {
  const text = String(message || '').trim();
  if (!text) return { sent: false, reason: 'message-not-configured' };

  const jid = String(sock?.user?.id || '').trim();
  if (!jid || typeof sock?.sendMessage !== 'function') {
    logger.warn?.('Skipped connection welcome because the linked account identity is unavailable.');
    return { sent: false, reason: 'account-identity-unavailable' };
  }

  const directory = path.resolve(stateDir);
  const marker = path.join(directory, `.connect-welcome-${accountKey(jid)}.sent`);
  const existingAttempt = activeAttempts.get(marker);
  if (existingAttempt) return existingAttempt;

  const attempt = (async () => {
    await fs.mkdir(directory, { recursive: true });
    if (await exists(marker)) return { sent: false, reason: 'already-sent' };

    const lockPath = `${marker}.lock`;
    const lock = await acquireLock(lockPath);
    if (!lock) return { sent: false, reason: 'already-in-progress' };

    try {
      if (await exists(marker)) return { sent: false, reason: 'already-sent' };

      try {
        await sock.sendMessage(jid, { text });
      } catch (error) {
        logger.warn?.({ err: error?.message || error }, 'Connection welcome DM failed; it may retry after a later connection.');
        return { sent: false, reason: 'send-failed' };
      }

      try {
        await fs.writeFile(marker, `${new Date().toISOString()}\n`, { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      logger.info?.('One-time connection welcome sent to the linked account self-chat.');
      return { sent: true };
    } finally {
      await lock.close().catch(() => {});
      await fs.rm(lockPath, { force: true }).catch(() => {});
    }
  })();

  activeAttempts.set(marker, attempt);
  try {
    return await attempt;
  } finally {
    activeAttempts.delete(marker);
  }
}

module.exports = { sendConnectionWelcome };
