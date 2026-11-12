require('dotenv').config();
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;
const { useMultiFileAuthState, Browsers } = baileys;
const pino = require('pino');
const fs = require('fs');
const path = require('path');

(async () => {
  const phone = String(process.env.PHONE_NUMBER || '').replace(/\D/g, '');
  const sessionDir = path.resolve(process.env.SESSION_DIR || './session/auth');
  const sessionIdPath = path.resolve(process.env.SESSION_ID_FILE || './SESSION_ID.txt');
  if (phone.length < 10 || phone.length > 15) throw new Error('A valid PHONE_NUMBER is required.');
  if (!fs.existsSync(sessionIdPath)) throw new Error('SESSION_ID.txt was not found.');
  const sessionId = fs.readFileSync(sessionIdPath, 'utf8').trim();
  if (!sessionId) throw new Error('SESSION_ID.txt is empty.');
  if (!/^[A-Za-z0-9+/]+=*$/.test(sessionId)) throw new Error('SESSION_ID.txt is not valid base64 data.');
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  if (!state.creds.registered || !state.creds.me?.id) throw new Error('Registered WhatsApp credentials or self-chat identity are missing.');

  const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, browser: Browsers.ubuntu('Chrome') });
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
    const recipient = state.creds.me.id;

    // Plain text so you can long-press → Copy without downloading a file.
    await sock.sendMessage(recipient, {
      text:
        'BRITECH MD — Your WhatsApp SESSION_ID\n\n' +
        'Copy the full string below (long-press → Copy). Paste it into the SESSION_ID setting on your bot host. Keep it private.\n\n' +
        sessionId
    });

    // Optional backup file (same value).
    await sock.sendMessage(recipient, {
      document: Buffer.from(sessionId, 'utf8'),
      mimetype: 'text/plain',
      fileName: 'BRITECH-MD-SESSION_ID.txt',
      caption: 'Backup copy of your SESSION_ID (same value as the text message above).'
    });

    console.log('SESSION_ID delivered as plain text (and file backup) to the linked WhatsApp self-chat. The ID was not printed in Actions logs.');
  } finally {
    try { await sock.end(undefined); } catch {}
  }
})().catch(error => {
  console.error('SESSION_ID WhatsApp delivery failed:', error.message || error);
  process.exit(1);
});
