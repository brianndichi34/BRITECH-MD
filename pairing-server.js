require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = baileys;
const pino = require('pino');
const { createSessionId, getVerifiedRecipient, createDeliveryMessages } = require('./lib/pairing-session');

const PORT = Number(process.env.PORT || process.env.PAIRING_PORT || 3000);
const HOST = '0.0.0.0';
const TOKEN = process.env.PAIRING_DASHBOARD_TOKEN || '';
const SESSION_DIR = path.resolve(process.env.SESSION_DIR || './session/auth');
const PUBLIC_DIR = path.join(__dirname, 'pairing-web');
const log = pino({ level: process.env.LOG_LEVEL || 'info' });
let pairSocket = null;
let pairingCode = '';
let pairingPhone = '';
let pairStatus = 'idle';
let pairError = '';
let botProcess = null;
let startLock = false;

function safeEqual(a, b) {
  const crypto = require('crypto');
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function authorized(req) {
  return TOKEN && safeEqual(req.headers.authorization?.replace(/^Bearer\s+/i, ''), TOKEN);
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
    log.info('BRITECH MD bot process started after pairing.');
  } finally { startLock = false; }
}
async function startPairing(phone) {
  if (pairSocket) throw new Error('A pairing attempt is already running. Wait or restart the attempt.');
  const number = String(phone || '').replace(/\D/g, '');
  if (number.length < 10 || number.length > 15) throw new Error('Enter a valid international number with country code, digits only.');
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  if (fs.existsSync(path.join(SESSION_DIR, 'creds.json'))) {
    const existing = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, 'creds.json'), 'utf8'));
    if (existing.registered) throw new Error('This service already has a registered WhatsApp session. Do not overwrite it. Remove the old linked device and clear the session folder only if you intentionally want to pair again.');
  }
  pairStatus = 'connecting'; pairingCode = ''; pairingPhone = number; pairError = '';
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'), markOnlineOnConnect: false, syncFullHistory: false
  });
  pairSocket = sock;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async update => {
    if (update.connection === 'connecting' && !pairingCode && !state.creds.registered) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1200));
        if (pairSocket !== sock || pairingCode) return;
        pairingCode = await sock.requestPairingCode(number);
        pairStatus = 'code_ready';
        log.info('Pairing code generated; it is intentionally hidden from server logs.');
      } catch (error) {
        pairError = error.message || 'Could not request a pairing code.';
        pairStatus = 'error';
        log.error({ message: pairError }, 'Pair-code request failed');
        try { sock.end(undefined); } catch {}
        pairSocket = null;
      }
    }
    if (update.connection === 'open') {
      pairStatus = 'sending_session';
      pairingCode = '';
      log.info('WhatsApp pairing confirmed.');
      setTimeout(async () => {
        try {
          const recipient = getVerifiedRecipient(number, state.creds.me?.id);
          const sessionId = createSessionId(state.creds);
          const [notice, sessionText] = createDeliveryMessages(sessionId);
          await sock.sendMessage(recipient, { text: notice });
          await sock.sendMessage(recipient, { text: sessionText });
          pairStatus = 'linked';
          log.info('SESSION_ID sent as a standalone copyable text message to the verified pairing number.');
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
      const status = update.lastDisconnect?.error?.output?.statusCode;
      pairError = status === DisconnectReason.loggedOut ? 'WhatsApp rejected the session. Remove old linked devices and try again.' : 'WhatsApp connection closed. Start a fresh pairing attempt.';
      pairStatus = 'error'; pairingCode = ''; pairSocket = null;
    }
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname.startsWith('/api/')) {
    if (!authorized(req)) return json(res, 401, { error: 'Unauthorized. Enter the private pairing dashboard token.' });
    if (req.method === 'POST' && url.pathname === '/api/pair/start') {
      try { const body = await readBody(req); await startPairing(body.phone); return json(res, 200, { status: pairStatus }); }
      catch (error) { return json(res, 400, { error: error.message || 'Could not start pairing.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/pair/status') {
      return json(res, 200, { status: pairStatus, phone: pairingPhone, code: pairingCode, error: pairError });
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
  log.info({ port: PORT }, 'BRITECH MD pairing dashboard is online.');
  const creds = path.join(SESSION_DIR, 'creds.json');
  if (fs.existsSync(creds)) {
    try {
      if (JSON.parse(fs.readFileSync(creds, 'utf8')).registered) await launchBot();
    } catch (error) { log.error(error, 'Existing session could not be started'); }
  }
});
process.on('SIGTERM', () => { try { pairSocket?.end(undefined); botProcess?.kill('SIGTERM'); } catch {} server.close(); });
process.on('SIGINT', () => { try { pairSocket?.end(undefined); botProcess?.kill('SIGINT'); } catch {} server.close(); });
