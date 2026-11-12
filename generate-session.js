require('dotenv').config();
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const sessionDir = path.resolve(process.env.SESSION_DIR || './session/auth');
const ciMode = process.argv.includes('--ci') || process.env.CI === 'true';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));

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
  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['BRITECH MD', 'Chrome', '1.0.0']
  });
  sock.ev.on('creds.update', saveCreds);

  try {
    const code = await sock.requestPairingCode(phone);
    console.log('\nPAIRING CODE: ' + code + '\n');
    console.log('Enter it on your phone under WhatsApp > Linked devices > Link with phone number instead.');
    console.log('Keep this process running until the connection is confirmed.');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Pairing timed out after 3 minutes. Run the session workflow again.')), 180000);
      sock.ev.on('connection.update', update => {
        if (update.connection === 'open') { clearTimeout(timeout); resolve(); }
        if (update.connection === 'close' && update.lastDisconnect?.error) {
          clearTimeout(timeout);
          reject(update.lastDisconnect.error);
        }
      });
    });
    fs.writeFileSync(path.join(path.dirname(sessionDir), 'SESSION_INFO.txt'),
      'BRITECH MD session created: ' + new Date().toISOString() + '\nAuth folder: ' + sessionDir + '\nKeep the entire auth folder private. Never commit or share it.\n');
    console.log('\nWhatsApp linked successfully. Session files saved.');
  } finally {
    try { await sock.end(undefined); } catch {}
    rl.close();
  }
})().catch(error => {
  console.error('\nSession generation failed:', error.message || error);
  rl.close();
  process.exitCode = 1;
});
