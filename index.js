const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('./lib/config');
const { handleMessage } = require('./lib/handler');

let stopping = false;
let reconnectTimer;
const logger = pino({ level: config.logLevel });

/** Expand SESSION_ID env into sessionDir/creds.json when the auth folder is empty. */
function hydrateSessionFromEnv() {
  const sessionId = String(process.env.SESSION_ID || '').trim();
  if (!sessionId) return;
  const dir = path.resolve(config.sessionDir);
  fs.mkdirSync(dir, { recursive: true });
  const credsPath = path.join(dir, 'creds.json');
  if (fs.existsSync(credsPath)) return; // do not overwrite a live session

  try {
    let payload = sessionId;
    if (payload.startsWith('BRITECH:\~')) payload = payload.slice('BRITECH:\~'.length);
    let raw;
    try {
      raw = zlib.inflateSync(Buffer.from(payload, 'base64'));
    } catch {
      // Legacy: uncompressed base64 of creds.json
      raw = Buffer.from(payload, 'base64');
    }
    const text = raw.toString('utf8');
    JSON.parse(text); // validate
    fs.writeFileSync(credsPath, text);
    logger.info('Loaded SESSION_ID into auth folder.');
  } catch (error) {
    logger.error({ err: error.message }, 'Failed to hydrate SESSION_ID; fix or remove SESSION_ID.');
    throw error;
  }
}

async function startBot() {
  if (stopping) return;
  fs.mkdirSync(path.resolve(config.sessionDir), { recursive: true });
  hydrateSessionFromEnv();
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
  sock.ev.on('connection.update', update => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') logger.info(`✅ ${config.botName} connected as ${sock.user?.id}`);
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
    if (type !== 'notify') return;
    for (const msg of messages) await handleMessage(sock, msg).catch(err => logger.error(err));
  });
  sock.ev.on('group-participants.update', async update => {
    if (update.action !== 'add') return;
    const welcome = process.env.WELCOME_MESSAGE;
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
