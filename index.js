const pino = require('pino');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const { dispatchUpsert } = require('./lib/message-dispatcher');
const { hydrateSessionId } = require('./lib/session-id');
const { createAntiDelete } = require('./lib/anti-delete');
const { sendConnectionWelcome } = require('./lib/connection-welcome');
const { createBadMacRecovery, isBadMacError } = require('./lib/session-recovery');
const { loadBaileys } = require('./lib/baileys');
const { startHealthServer } = require('./lib/health-server');
const { getBotAvatarPath } = require('./lib/brand-assets');
const { secureSessionDirectory } = require('./lib/session-permissions');

let stopping = false;
let reconnectTimer;
let reconnectAttempt = 0;
let startInFlight = false;
let activeSocket = null;
let healthServer = null;
let profileInitialized = false;
let logger;
const sessionRecovery = createBadMacRecovery({
  sessionDir: path.resolve(config.sessionDir),
  threshold: config.badMacRecoveryThreshold,
  logger: {
    warn(...args) { logger?.warn(...args); },
    error(...args) { logger?.error(...args); }
  },
  onRecovered: async result => {
    logger.error({ candidate: result.candidate, preserved: result.preserved }, 'Session recovery completed; restarting BRITECH-MD once.');
    setTimeout(() => process.exit(1), 750).unref();
  }
});
logger = pino({
    level: config.logLevel,
    hooks: {
      logMethod(inputArgs, method) {
      if (config.autoSessionRecovery) inputArgs.forEach(argument => sessionRecovery.observe(argument));
      method.apply(this, inputArgs);
    }
  }
});
healthServer = startHealthServer({ port: process.env.PORT, logger });
const antiDelete = createAntiDelete();

async function initializeBotProfile(sock) {
  if (profileInitialized || !config.autoSetBotProfile || typeof sock.updateProfilePicture !== 'function') return;
  const profilePath = getBotAvatarPath();
  if (!profilePath || !sock.user?.id) return;
  try {
    await sock.updateProfilePicture(sock.user.id, fs.readFileSync(profilePath));
    profileInitialized = true;
    logger.info('BRITECH-MD profile picture initialized from its saved avatar.');
  } catch (error) {
    logger.warn({ err: error?.message || error }, 'Could not initialize the WhatsApp profile picture; .setmenuprofile can retry.');
  }
}

/** Import SESSION_ID only when no existing auth session is present. */
async function hydrateSessionFromEnv() {
  try {
    const result = await hydrateSessionId(process.env.SESSION_ID, config.sessionDir);
    if (result.loaded) logger.info({ files: result.files, format: result.format }, 'Loaded SESSION_ID into auth folder.');
  } catch (error) {
    logger.error({ err: error.message }, 'Failed to hydrate SESSION_ID; fix it or remove it.');
    throw error;
  }
}

function scheduleReconnect(code) {
  if (stopping || reconnectTimer) return;
  const delay = Math.min(60_000, 5_000 * (2 ** Math.min(reconnectAttempt, 3))) + Math.floor(Math.random() * 1_500);
  reconnectAttempt += 1;
  logger.warn({ code, delay, attempt: reconnectAttempt }, 'Connection closed; scheduling one supervised reconnect.');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    startBot().catch(error => {
      logger.error({ err: error?.message || error }, 'Reconnect failed; scheduling another attempt.');
      scheduleReconnect('startup-error');
    });
  }, delay);
}
async function startBot() {
  if (stopping || startInFlight) return activeSocket;
  startInFlight = true;
  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await loadBaileys();
    secureSessionDirectory(config.sessionDir);
    await hydrateSessionFromEnv();
    secureSessionDirectory(config.sessionDir);
    const { state, saveCreds } = await useMultiFileAuthState(path.resolve(config.sessionDir));
    const savePrivateCreds = async () => {
      await saveCreds();
      secureSessionDirectory(config.sessionDir);
    };
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); }
    catch { logger.warn('Could not fetch latest WhatsApp Web version; using library default.'); }
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: logger.child({ module: 'baileys' }),
      printQRInTerminal: false,
      browser: [config.botName, 'Chrome', '1.0.0'],
      markOnlineOnConnect: true,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 60000
    });
    activeSocket = sock;
    sock.ev.on('creds.update', savePrivateCreds);
    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect } = update;
      if (config.autoSessionRecovery && isBadMacError(lastDisconnect?.error)) {
        sessionRecovery.observe(lastDisconnect.error);
      }
      if (connection === 'open') {
        reconnectAttempt = 0;
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        logger.info(`✅ ${config.botName} connected as ${sock.user?.id}`);
        try { await sendConnectionWelcome(sock, config.welcomeMessage, { logger }); }
        catch (error) { logger.error({ err: error?.message || error }, 'Could not persist the one-time connection welcome marker.'); }
        await initializeBotProfile(sock);
      }
      if (connection === 'close' && activeSocket === sock && !stopping) {
        activeSocket = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          logger.error('WhatsApp logged out. Pair again using the session generator.');
          return;
        }
        scheduleReconnect(code);
      }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      antiDelete.remember(sock, messages, config);
      await dispatchUpsert(sock, messages, type, config, logger);
    });
    sock.ev.on('messages.update', updates => {
      antiDelete.handleUpdates(sock, updates, config, logger).catch(error => {
        logger.warn({ err: error?.message || error }, 'Anti-delete message handling failed.');
      });
    });
    sock.ev.on('group-participants.update', async update => {
      if (update.action !== 'add') return;
      const welcome = config.welcomeMessage;
      if (!welcome) return;
      const text = welcome.replace('{user}', update.participants.map(p => `@${p.split('@')[0]}`).join(', '));
      await sock.sendMessage(update.id, { text, mentions: update.participants }).catch(err => logger.warn(err));
    });
    return sock;
  } finally {
    startInFlight = false;
  }
}

async function shutdown() {
  stopping = true;
  clearTimeout(reconnectTimer);
  try { await activeSocket?.end?.(undefined); } catch {}
  try { await new Promise(resolve => healthServer ? healthServer.close(resolve) : resolve()); } catch {}
  logger.info('Stopping BRITECH-MD...');
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', error => logger.error({ error }, 'Unhandled rejection'));
process.on('uncaughtException', error => { logger.fatal({ error }, 'Uncaught exception'); process.exit(1); });

startBot().catch(error => { logger.fatal(error, 'Failed to start bot'); process.exit(1); });
