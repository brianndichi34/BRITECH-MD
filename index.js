const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const { dispatchUpsert } = require('./lib/message-dispatcher');
const { hydrateSessionId } = require('./lib/session-id');
const { createAntiDelete } = require('./lib/anti-delete');
const { sendConnectionWelcome } = require('./lib/connection-welcome');

let stopping = false;
let reconnectTimer;
let profileInitialized = false;
const logger = pino({ level: config.logLevel });
const antiDelete = createAntiDelete();

async function initializeBotProfile(sock) {
  if (profileInitialized || !config.autoSetBotProfile || typeof sock.updateProfilePicture !== 'function') return;
  const customPath = path.join(__dirname, 'assets', 'menu-profile.jpg');
  const generatedPath = path.join(__dirname, 'assets', 'britech-md-avatar.png');
  const profilePath = fs.existsSync(customPath) ? customPath : generatedPath;
  if (!fs.existsSync(profilePath) || !sock.user?.id) return;
  try {
    await sock.updateProfilePicture(sock.user.id, fs.readFileSync(profilePath));
    profileInitialized = true;
    logger.info('BRITECH MD profile picture initialized from its saved avatar.');
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

async function startBot() {
  if (stopping) return;
  fs.mkdirSync(path.resolve(config.sessionDir), { recursive: true });
  await hydrateSessionFromEnv();
  const { state, saveCreds } = await useMultiFileAuthState(path.resolve(config.sessionDir));
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

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      logger.info(`✅ ${config.botName} connected as ${sock.user?.id}`);
      try { await sendConnectionWelcome(sock, config.welcomeMessage, { logger }); }
      catch (error) { logger.error({ err: error?.message || error }, 'Could not persist the one-time connection welcome marker.'); }
      await initializeBotProfile(sock);
    }
    if (connection === 'close' && !stopping) {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        logger.error('WhatsApp logged out. Pair again using the session generator.');
        return;
      }
      logger.warn({ code }, 'Connection closed; reconnecting in 5 seconds.');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => startBot().catch(err => logger.error(err)), 5000);
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
}

async function shutdown() {
  stopping = true;
  clearTimeout(reconnectTimer);
  logger.info('Stopping BRITECH MD...');
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', error => logger.error({ error }, 'Unhandled rejection'));
process.on('uncaughtException', error => { logger.fatal({ error }, 'Uncaught exception'); process.exit(1); });

startBot().catch(error => { logger.fatal(error, 'Failed to start bot'); process.exit(1); });
