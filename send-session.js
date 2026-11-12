require('dotenv').config();
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;
const { useMultiFileAuthState, DisconnectReason, Browsers } = baileys;
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const phone = String(process.env.PHONE_NUMBER || '').replace(/\D/g, '');
  const sessionDir = path.resolve(process.env.SESSION_DIR || './session/auth');
  const sessionIdPath = path.resolve(process.env.SESSION_ID_FILE || './SESSION_ID.txt');

  if (phone.length < 10 || phone.length > 15) throw new Error('A valid PHONE_NUMBER is required.');
  if (!fs.existsSync(sessionIdPath)) throw new Error('SESSION_ID.txt was not found.');
  const sessionId = fs.readFileSync(sessionIdPath, 'utf8').trim();
  if (!sessionId) throw new Error('SESSION_ID.txt is empty.');
  if (sessionId.length > 60000) throw new Error('SESSION_ID is too long for one WhatsApp message; secure artifact is still available.');

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  if (!state.creds.registered) throw new Error('WhatsApp credentials are not registered; refusing to send an empty session.');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome')
  });
  sock.ev.on('creds.update', saveCreds);

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out reconnecting to WhatsApp to deliver the session DM.')), 90000);
      sock.ev.on('connection.update', update => {
        if (update.connection === 'open') { clearTimeout(timer); resolve(); }
        if (update.connection === 'close') {
          clearTimeout(timer);
          const status = update.lastDisconnect?.error?.output?.statusCode;
          reject(new Error('WhatsApp reconnect closed before delivery (status ' + (status || 'unknown') + ').'));
        }
      });
    });

    const recipient = state.creds.me?.id || (phone + '@s.whatsapp.net');
    const message = 'BRITECH MD — Your WhatsApp SESSION_ID\n\nCopy the complete text below into the SESSION_ID setting on your bot host. Keep it private: anyone with this ID may be able to access your WhatsApp session.\n\n' + sessionId;
    await sock.sendMessage(recipient, { text: message });
    console.log('SESSION_ID delivered to the WhatsApp account linked by this workflow. The ID was not printed in the Actions log.');
    await sleep(1500);
  } finally {
    try { await sock.end(undefined); } catch {}
  }
})().catch(error => {
  console.error('SESSION_ID WhatsApp delivery failed:', error.message || error);
  process.exit(1);
});
