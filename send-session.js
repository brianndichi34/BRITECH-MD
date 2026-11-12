require('dotenv').config();
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;
const { useMultiFileAuthState, Browsers } = baileys;
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { getVerifiedRecipient, createDeliveryMessages } = require('./lib/pairing-session');

(async () => {
  const phone = String(process.env.PHONE_NUMBER || '').replace(/\D/g, '');
  const sessionDir = path.resolve(process.env.SESSION_DIR || './session/auth');
  const sessionIdPath = path.resolve(process.env.SESSION_ID_FILE || './SESSION_ID.txt');
  if (phone.length < 10 || phone.length > 15) throw new Error('A valid PHONE_NUMBER is required.');
  if (!fs.existsSync(sessionIdPath)) throw new Error('SESSION_ID.txt was not found.');
  const sessionId = fs.readFileSync(sessionIdPath, 'utf8').trim();
  if (!sessionId) throw new Error('SESSION_ID.txt is empty.');

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  if (!state.creds.registered || !state.creds.me?.id) {
    throw new Error('Registered WhatsApp credentials or self-chat identity are missing.');
  }

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome')
  });
  sock.ev.on('creds.update', saveCreds);

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out reconnecting to WhatsApp to deliver the session.')), 90000);
      sock.ev.on('connection.update', update => {
        if (update.connection === 'open') { clearTimeout(timer); resolve(); }
        if (update.connection === 'close') {
          clearTimeout(timer);
          reject(new Error('WhatsApp reconnect closed before delivery (status ' + (update.lastDisconnect?.error?.output?.statusCode || 'unknown') + ').'));
        }
      });
    });

    const recipient = getVerifiedRecipient(phone, state.creds.me);
    const [notice, sessionText] = createDeliveryMessages(sessionId);
    const noticeResult = await sock.sendMessage(recipient, { text: notice });
    if (!noticeResult?.key?.id) throw new Error('WhatsApp did not acknowledge the SESSION_ID instruction message.');
    // Keep the sensitive session value in its own plain-text DM for easy copying.
    const sessionResult = await sock.sendMessage(recipient, { text: sessionText });
    if (!sessionResult?.key?.id) throw new Error('WhatsApp did not acknowledge the SESSION_ID message.');
    console.log('WhatsApp accepted both messages in the verified account self-chat. SESSION_ID was sent separately as copyable text; its value is not printed in Actions logs.');
  } finally {
    try { await sock.end(undefined); } catch {}
  }
})().catch(error => {
  console.error('SESSION_ID WhatsApp delivery failed:', error.message || error);
  process.exit(1);
});
