require('dotenv').config();
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = baileys;
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const sessionDir = path.resolve(process.env.SESSION_DIR || './session/auth');
const ciMode = process.argv.includes('--ci') || process.env.CI === 'true';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\nBRITECH MD — WhatsApp session pairing');
  console.log('On your phone: WhatsApp > Linked devices > Link with phone number instead.\n');

  if (fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length) {
    if (process.env.SESSION_REPLACE !== 'YES') {
      throw new Error('An existing auth folder was found. It was NOT changed. Back it up first; set SESSION_REPLACE=YES only if you intentionally want to replace it.');
    }
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  let phoneInput = process.env.PHONE_NUMBER || '';
  if (!phoneInput && !ciMode) phoneInput = await ask('WhatsApp number in international format, digits only (e.g. 2547XXXXXXXX): ');
  const phone = String(phoneInput).replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 15) throw new Error('Set a valid international PHONE_NUMBER, e.g. 2547XXXXXXXX.');

  fs.mkdirSync(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch {}

  let pairingRequested = false;

  // Opens a socket. Requests the pairing code only once the websocket is really
  // connected (the "qr" event), and reconnects when WhatsApp asks for a restart
  // right after linking (status 515), which is normal.
  const connect = () => new Promise((resolve, reject) => {
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome')
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update;
      if (qr && !state.creds.registered && !pairingRequested) {
        pairingRequested = true;
        try {
          const code = await sock.requestPairingCode(phone);
          console.log('\nPAIRING CODE: ' + code + '\n');
          console.log('Enter it on your phone under WhatsApp > Linked devices > Link with phone number instead.');
          console.log('Keep this process running until the connection is confirmed.');
        } catch (e) { reject(e); }
      }
      if (connection === 'open') resolve(sock);
      if (connection === 'close') {
        const status = lastDisconnect?.error?.output?.statusCode;
        if (status === DisconnectReason.restartRequired) {
          connect().then(resolve, reject);
        } else if (state.creds.registered && status !== DisconnectReason.loggedOut) {
          connect().then(resolve, reject);
        } else {
          reject(lastDisconnect?.error || new Error('Connection closed'));
        }
      }
    });
  });

  let sock;
  try {
    sock = await Promise.race([
      connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Pairing timed out after 3 minutes. Run the session workflow again.')), 180000))
    ]);
    await sleep(5000); // let credentials finish saving
    fs.writeFileSync(path.join(path.dirname(sessionDir), 'SESSION_INFO.txt'),
      'BRITECH MD session created: ' + new Date().toISOString() + '\nAuth folder: ' + sessionDir + '\nKeep the entire auth folder private. Never commit or share it.\n');
    console.log('\nWhatsApp linked successfully. Session files saved.');
  } finally {
    try { await sock?.end(undefined); } catch {}
    rl.close();
  }
})().catch(error => {
  console.error('\nSession generation failed:', error.message || error);
  rl.close();
  process.exitCode = 1;
});
