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
const botProcesses = new Map();
const botStartLocks = new Set();
let pairAttemptTimer = null;
let pairingSessionDir = '';

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
function registeredSessionDirs() {
  if (!fs.existsSync(SESSION_DIR)) return [];
  const dirs = [];
  const candidates = [SESSION_DIR, ...fs.readdirSync(SESSION_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => path.join(SESSION_DIR, entry.name))];
  for (const dir of candidates) {
    try {
      const creds = JSON.parse(fs.readFileSync(path.join(dir, 'creds.json'), 'utf8'));
      if (creds.registered) dirs.push(path.resolve(dir));
    } catch {}
  }
  return dirs;
}
async function launchBot(sessionDir) {
  const resolved = path.resolve(sessionDir);
  if (botProcesses.has(resolved) || botStartLocks.has(resolved)) return;
  botStartLocks.add(resolved);
  try {
    if (!fs.existsSync(path.join(resolved, 'creds.json'))) throw new Error('Registered credentials not found.');
    const childEnv = { ...process.env, SESSION_DIR: resolved, PORT: '' };
    const child = spawn(process.execPath, ['index.js'], { cwd: __dirname, env: childEnv, stdio: 'inherit' });
    botProcesses.set(resolved, child);
    child.on('exit', (code) => { log.warn({ code, sessionDir: path.basename(resolved) }, 'Bot process stopped'); botProcesses.delete(resolved); });
    log.info({ sessionDir: path.basename(resolved) }, 'BRITECH-MD bot process started.');
  } finally { botStartLocks.delete(resolved); }
}
async function cancelActivePairAttempt() {
  const current = pairSocket;
  if (!current) return;
  pairSocket = null;
  clearTimeout(pairAttemptTimer);
  pairAttemptTimer = null;
  try { await current.end(undefined); } catch {}
  if (pairingSessionDir && !fs.existsSync(path.join(pairingSessionDir, 'creds.json'))) {
    fs.rmSync(pairingSessionDir, { recursive: true, force: true });
  }
  pairingSessionDir = '';
}
async function startPairing(phone) {
  await cancelActivePairAttempt();
  const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = await loadBaileys();
  const number = normalizePhone(phone);
  if (number.length < 10 || number.length > 15) throw new Error('Enter a valid international number with country code, digits only.');
  secureSessionDirectory(SESSION_DIR);
  const sessionDir = path.join(SESSION_DIR, `pairing-${Date.now()}-${number}`);
  pairingSessionDir = sessionDir;
  secureSessionDirectory(sessionDir);
  pairStatus = 'connecting'; pairingCode = ''; pairingPhone = number; pairError = ''; pairTextSent = false; pairDocumentSent = false; pairSessionSent = false; pairWelcomeSent = false;
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const savePrivateCreds = async () => {
    await saveCreds();
    secureSessionDirectory(sessionDir);
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
  pairAttemptTimer = setTimeout(async () => {
    if (pairSocket !== sock || ['linked', 'error'].includes(pairStatus)) return;
    pairStatus = 'error';
    pairingCode = '';
    pairError = 'Pairing timed out. Start a fresh attempt and enter the newest code promptly.';
    log.warn('Pairing attempt expired before WhatsApp confirmed the link.');
    pairSocket = null;
    pairAttemptTimer = null;
    pairExpiresAt = 0;
    try { await sock.end(undefined); } catch {}
    if (!state.creds.registered) fs.rmSync(sessionDir, { recursive: true, force: true });
  }, PAIRING_TIMEOUT_MS);
  sock.ev.on('creds.update', savePrivateCreds);
  sock.ev.on('connection.update', async update => {
    if (pairSocket !== sock) return;
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
        clearTimeout(pairAttemptTimer);
        pairAttemptTimer = null;
        pairExpiresAt = 0;
        log.error({ message: pairError }, 'Pair-code request failed');
        try { sock.end(undefined); } catch {}
        pairSocket = null;
      }
    }
    if (update.connection === 'open') {
      if (deliveryStarted) return;
      deliveryStarted = true;
      clearTimeout(pairAttemptTimer);
      pairAttemptTimer = null;
      pairStatus = 'sending_session';
      pairExpiresAt = 0;
      pairingCode = '';
      log.info('WhatsApp pairing confirmed.');
      setTimeout(async () => {
        if (pairSocket !== sock) return;
        try {
          const recipient = getVerifiedRecipient(number, state.creds.me);
          const sessionId = await createAuthArchiveSessionId(sessionDir);
          const delivery = await deliverSession(sock, recipient, sessionId);
          pairSessionSent = delivery.sessionSent;
          pairTextSent = delivery.textSent;
          pairDocumentSent = delivery.documentSent;
          const welcome = await sendConnectionWelcome(sock, config.welcomeMessage, {
            stateDir: sessionDir,
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
        await launchBot(sessionDir).catch(error => log.error(error, 'Could not start bot after pairing'));
      }, 1200);
    }
    if (update.connection === 'close' && pairStatus !== 'linked') {
      clearTimeout(pairAttemptTimer);
      pairAttemptTimer = null;
      const status = update.lastDisconnect?.error?.output?.statusCode;
      pairError = status === DisconnectReason.loggedOut ? 'WhatsApp rejected the session. Remove old linked devices and try again.' : 'WhatsApp connection closed. Start a fresh pairing attempt.';
      pairStatus = 'error'; pairingCode = ''; pairSocket = null; pairExpiresAt = 0;
      if (!state.creds.registered) fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
    return json(res, 200, { ok: true, service: 'BRITECH-MD' });
  }
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
  try {
    const imported = await hydrateSessionId(process.env.SESSION_ID, SESSION_DIR);
    if (imported.loaded) log.info({ files: imported.files, format: imported.format }, 'Loaded SESSION_ID into auth folder.');
    secureSessionDirectory(SESSION_DIR);
  } catch (error) {
    // A stale or truncated host SESSION_ID must not take down the pairing dashboard.
    // Operators can pair a fresh account from the dashboard after clearing the bad value.
    log.warn({ message: error.message }, 'SESSION_ID import skipped; pairing dashboard remains available.');
  }
  for (const sessionDir of registeredSessionDirs()) {
    await launchBot(sessionDir).catch(error => log.error({ err: error, sessionDir: path.basename(sessionDir) }, 'Existing session could not be started'));
  }
});
function stopAllBots(signal) {
  for (const child of botProcesses.values()) {
    try { child.kill(signal); } catch {}
  }
}
process.on('SIGTERM', () => { try { pairSocket?.end(undefined); stopAllBots('SIGTERM'); } catch {} server.close(); });
process.on('SIGINT', () => { try { pairSocket?.end(undefined); stopAllBots('SIGINT'); } catch {} server.close(); });
