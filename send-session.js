require('dotenv').config();
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;
const { useMultiFileAuthState, Browsers } = baileys;
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { getVerifiedRecipient, deliverSession } = require('./lib/pairing-session');

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
    const delivery = await deliverSession(sock, recipient, sessionId);
    if (delivery.documentSent) console.log('WhatsApp server acknowledged the SESSION_ID Word document for the verified phone-number DM.');
    else console.warn('The Word document did not receive a WhatsApp server acknowledgement: ' + delivery.documentError);
    if (delivery.textSent) console.log('WhatsApp server acknowledged the separate plain-text SESSION_ID message(s). The value is not printed in Actions logs.');
    else console.warn('The separate plain-text SESSION_ID message(s) were not all acknowledged. ' + delivery.textError);
  } finally {
    try { await sock.end(undefined); } catch {}
  }
})().catch(error => {
  console.error('SESSION_ID WhatsApp delivery failed:', error.message || error);
  process.exit(1);
});
