require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pino = require('pino');
const config = require('./lib/config');
const { createAuthArchiveSessionId, getVerifiedRecipient, deliverSession, normalizePhone } = require('./lib/pairing-session');
const { loadBaileys } = require('./lib/baileys');
const { hydrateSessionId } = require('./lib/session-id');
const { sendConnectionWelcome } = require('./lib/connection-welcome');
const { isProtected, isAuthorized } = require('./lib/dashboard-access');
const { secureSessionDirectory } = require('./lib/session-permissions');

const PORT = Number(process.env.PORT || process.env.PAIRING_PORT || 3000);
const HOST = '0.0.0.0';
const TOKEN = String(process.env.PAIRING_DASHBOARD_TOKEN || '').trim();
function configuredPairingUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}
const PAIRING_DASHBOARD_URL = configuredPairingUrl(process.env.PAIRING_DASHBOARD_URL);
const SESSION_DIR = path.resolve(process.env.SESSION_DIR || './session/auth');
const PUBLIC_DIR = path.join(__dirname, 'pairing-web');
const configuredPairingTimeout = Number(process.env.PAIRING_TIMEOUT_MS);
const PAIRING_TIMEOUT_MS = Number.isFinite(configuredPairingTimeout) && configuredPairingTimeout > 0
  ? Math.max(60_000, configuredPairingTimeout) : 5 * 60 * 1000;
const log = pino({ level: process.env.LOG_LEVEL || 'info' });
let pairSocket = null;
let pairingCode = '';
let pairingPhone = '';
let pairStatus = 'idle';
let pairError = '';
let pairTextSent = false;
let pairDocumentSent = false;
let pairSessionSent = false;
let pairWelcomeSent = false;
let pairExpiresAt = 0;
let botProcess = null;
let startLock = false;

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function authorized(req) {
  return isAuthorized(TOKEN, req.headers.authorization);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 4096) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
async function launchBot() {
  if (botProcess || startLock) return;
  startLock = true;
  try {
    if (!fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) throw new Error('Registered credentials not found.');
    botProcess = spawn(process.execPath, ['index.js'], { cwd: __dirname, env: process.env, stdio: 'inherit' });
    botProcess.on('exit', (code) => { log.warn({ code }, 'Bot process stopped'); botProcess = null; });
    log.info('BRITECH-MD bot process started after pairing.');
  } finally { startLock = false; }
}
async function startPairing(phone) {
  if (pairSocket) throw new Error('A pairing attempt is already running. Wait or restart the attempt.');
  const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = await loadBaileys();
  const number = normalizePhone(phone);
  if (number.length < 10 || number.length > 15) throw new Error('Enter a valid international number with country code, digits only.');
  const credsPath = path.join(SESSION_DIR, 'creds.json');
  secureSessionDirectory(SESSION_DIR);
  if (fs.existsSync(credsPath)) {
    let existing;
    try { existing = JSON.parse(fs.readFileSync(credsPath, 'utf8')); } catch {}
    if (existing?.registered) throw new Error('This service already has a registered WhatsApp session. Do not overwrite it. Remove the old linked device and clear the session folder only if you intentionally want to pair again.');
    // A rejected/expired attempt can leave an unregistered creds.json and stale
    // pre-keys behind. They must not be reused for the next phone-number link.
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    secureSessionDirectory(SESSION_DIR);
  }
  pairStatus = 'connecting'; pairingCode = ''; pairingPhone = number; pairError = ''; pairTextSent = false; pairDocumentSent = false; pairSessionSent = false; pairWelcomeSent = false;
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const savePrivateCreds = async () => {
    await saveCreds();
    secureSessionDirectory(SESSION_DIR);
  };
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), markOnlineOnConnect: false, syncFullHistory: false
  });
  pairSocket = sock;
  let deliveryStarted = false;
  pairExpiresAt = Date.now() + PAIRING_TIMEOUT_MS;
  const attemptTimer = setTimeout(async () => {
    if (pairSocket !== sock || ['linked', 'error'].includes(pairStatus)) return;
    pairStatus = 'error';
    pairingCode = '';
    pairError = 'Pairing timed out. Start a fresh attempt and enter the newest code promptly.';
    log.warn('Pairing attempt expired before WhatsApp confirmed the link.');
    pairSocket = null;
    pairExpiresAt = 0;
    try { await sock.end(undefined); } catch {}
    if (!state.creds.registered) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  }, PAIRING_TIMEOUT_MS);
  sock.ev.on('creds.update', savePrivateCreds);
  sock.ev.on('connection.update', async update => {
    const { connection, qr } = update;
    // requestPairingCode must follow Baileys' initial pair-device handshake.
    // Calling it immediately on `connecting` intermittently produces codes
    // that WhatsApp rejects on slower hosts or after a version negotiation.
    if (qr && !pairingCode && !state.creds.registered) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (pairSocket !== sock || pairingCode || state.creds.registered) return;
      let lastError;
      for (let attempt = 1; attempt <= 3 && pairSocket === sock && !pairingCode; attempt++) {
        try {
          pairingCode = await sock.requestPairingCode(number);
          pairStatus = 'code_ready';
          log.info('Pairing code generated; it is intentionally hidden from server logs.');
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1800));
        }
      }
      if (!pairingCode && pairSocket === sock) {
        pairError = lastError?.message || 'Could not request a pairing code. Start a fresh attempt.';
        pairStatus = 'error';
        clearTimeout(attemptTimer);
        pairExpiresAt = 0;
        log.error({ message: pairError }, 'Pair-code request failed');
        try { sock.end(undefined); } catch {}
        pairSocket = null;
      }
    }
    if (update.connection === 'open') {
      if (deliveryStarted) return;
      deliveryStarted = true;
      clearTimeout(attemptTimer);
      pairStatus = 'sending_session';
      pairExpiresAt = 0;
      pairingCode = '';
      log.info('WhatsApp pairing confirmed.');
      setTimeout(async () => {
        try {
          const recipient = getVerifiedRecipient(number, state.creds.me);
          const sessionId = await createAuthArchiveSessionId(SESSION_DIR);
          const delivery = await deliverSession(sock, recipient, sessionId);
          pairSessionSent = delivery.sessionSent;
          pairTextSent = delivery.textSent;
          pairDocumentSent = delivery.documentSent;
          const welcome = await sendConnectionWelcome(sock, config.welcomeMessage, {
            stateDir: path.dirname(SESSION_DIR),
            logger: log
          });
          pairWelcomeSent = welcome.sent;
          pairStatus = 'linked';
          log.info({ sessionDeliveryAcknowledged: pairSessionSent, wordDocumentAcknowledged: pairDocumentSent, plainTextAcknowledged: pairTextSent, welcomeSent: pairWelcomeSent }, 'SESSION_ID delivery and linked-account welcome finished.');
        } catch (error) {
          pairStatus = 'error';
          pairError = 'WhatsApp linked, but SESSION_ID delivery failed. Check the entered number and connection, then contact the bot owner before retrying.';
          log.error({ message: error.message || 'Unknown session delivery error' }, 'Could not deliver SESSION_ID after pairing.');
        }
        if (pairSocket === sock) {
          try { await sock.end(undefined); } catch {}
          pairSocket = null;
        }
        await launchBot().catch(error => log.error(error, 'Could not start bot after pairing'));
      }, 1200);
    }
    if (update.connection === 'close' && pairStatus !== 'linked') {
      clearTimeout(attemptTimer);
      const status = update.lastDisconnect?.error?.output?.statusCode;
      pairError = status === DisconnectReason.loggedOut ? 'WhatsApp rejected the session. Remove old linked devices and try again.' : 'WhatsApp connection closed. Start a fresh pairing attempt.';
      pairStatus = 'error'; pairingCode = ''; pairSocket = null; pairExpiresAt = 0;
      if (!state.creds.registered) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, { protected: isProtected(TOKEN), pairingUrl: PAIRING_DASHBOARD_URL });
    }
    if (!authorized(req)) return json(res, 401, { error: 'Unauthorized. Enter the private pairing dashboard token.' });
    if (req.method === 'POST' && url.pathname === '/api/pair/start') {
      try { const body = await readBody(req); await startPairing(body.phone); return json(res, 200, { status: pairStatus }); }
      catch (error) { return json(res, 400, { error: error.message || 'Could not start pairing.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/session/status') {
      return json(res, 200, {
        status: pairStatus,
        phone: pairingPhone,
        sessionSent: pairSessionSent,
        textSent: pairTextSent,
        documentSent: pairDocumentSent,
        welcomeSent: pairWelcomeSent,
        error: pairError
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/pair/status') {
      return json(res, 200, { status: pairStatus, phone: pairingPhone, code: pairingCode, error: pairError, sessionSent: pairSessionSent, textSent: pairTextSent, documentSent: pairDocumentSent, welcomeSent: pairWelcomeSent, expiresAt: pairExpiresAt });
    }
    return json(res, 404, { error: 'Not found' });
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Method not allowed'); }
  const file = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
  const target = path.join(PUBLIC_DIR, file);
  if (!target.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(target)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(target).pipe(res);
});
server.listen(PORT, HOST, async () => {
  log.info({ port: PORT }, 'BRITECH-MD pairing dashboard is online.');
  const creds = path.join(SESSION_DIR, 'creds.json');
  try {
    const imported = await hydrateSessionId(process.env.SESSION_ID, SESSION_DIR);
    if (imported.loaded) log.info({ files: imported.files, format: imported.format }, 'Loaded SESSION_ID into auth folder.');
    secureSessionDirectory(SESSION_DIR);
  } catch (error) {
    // A stale or truncated host SESSION_ID must not take down the pairing dashboard.
    // Operators can pair a fresh account from the dashboard after clearing the bad value.
    log.warn({ message: error.message }, 'SESSION_ID import skipped; pairing dashboard remains available.');
  }
  if (fs.existsSync(creds)) {
    try {
      if (JSON.parse(fs.readFileSync(creds, 'utf8')).registered) await launchBot();
    } catch (error) { log.error(error, 'Existing session could not be started'); }
  }
});
process.on('SIGTERM', () => { try { pairSocket?.end(undefined); botProcess?.kill('SIGTERM'); } catch {} server.close(); });
process.on('SIGINT', () => { try { pairSocket?.end(undefined); botProcess?.kill('SIGINT'); } catch {} server.close(); });
