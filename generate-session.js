require('dotenv').config();
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const sessionDir = path.resolve(process.env.SESSION_DIR || './session/auth');
const defaultPhone = (process.env.OWNER_NUMBER || '254717276195').replace(/\D/g, '');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));

(async () => {
  console.log('\nBRITECH MD — WhatsApp session pairing');
  console.log('WhatsApp > Linked devices > Link with phone number instead.\n');
  if (fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length) {
    const confirm = (await ask('An auth folder already exists. Replace it? Type YES to continue: ')).trim();
    if (confirm !== 'YES') { console.log('Cancelled. Existing session preserved.'); rl.close(); return; }
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
  const phoneInput = (await ask(`WhatsApp number in international format, digits only [${defaultPhone}]: `)).trim();
  const phone = (phoneInput || defaultPhone).replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 15) throw new Error('Enter a valid international phone number, e.g. 2547XXXXXXXX.');
  fs.mkdirSync(sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
  const sock = makeWASocket({ ...(version ? { version } : {}), auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, browser: ['BRITECH MD', 'Chrome', '1.0.0'] });
  sock.ev.on('creds.update', saveCreds);
  try {
    const code = await sock.requestPairingCode(phone);
    console.log(`\nPAIRING CODE: ${code}\n`);
    console.log('Enter this code on your phone under WhatsApp > Linked devices > Link with phone number.');
    console.log('Keep this process open until WhatsApp confirms that the device is linked.');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Pairing timed out. Run npm run session again.')), 180000);
      sock.ev.on('connection.update', update => {
        if (update.connection === 'open') { clearTimeout(timeout); resolve(); }
        if (update.connection === 'close' && update.lastDisconnect?.error) { clearTimeout(timeout); reject(update.lastDisconnect.error); }
      });
    });
    fs.writeFileSync(path.join(path.dirname(sessionDir), 'SESSION_INFO.txt'), `BRITECH MD session created: ${new Date().toISOString()}\nAuth folder: ${sessionDir}\nKeep the entire auth folder private. Never share it or commit it to a repository.\n`);
    console.log('\n✅ WhatsApp linked successfully. Session files saved.');
    console.log('Next: stop this process and run npm start.');
    await sock.end(undefined);
  } finally { rl.close(); }
})().catch(error => { console.error('\n❌ Session generation failed:', error.message || error); rl.close(); process.exitCode = 1; });
