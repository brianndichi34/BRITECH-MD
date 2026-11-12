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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

  const deadline = Date.now() + 5 * 60 * 1000;
  let attempts = 0;
  let linkedSocket = null;
  let lastError = null;

  while (Date.now() < deadline && attempts < 5 && !linkedSocket) {
    attempts++;
    let sock;
    const outcome = await new Promise(resolve => {
      let settled = false;
      let codeRequested = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome')
      });
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', async update => {
        const { connection, lastDisconnect, qr } = update;
        if (qr && !state.creds.registered && !codeRequested) {
          codeRequested = true;
          try {
            const code = await sock.requestPairingCode(phone);
            console.log('\nPAIRING CODE (attempt ' + attempts + '): ' + code + '\n');
            console.log('Enter this code in WhatsApp > Linked devices > Link with phone number instead.');
            console.log('If it expires, use the newest code printed by this workflow.\n');
          } catch (error) {
            lastError = error;
            finish({ type: 'retry', error });
          }
        }
        if (connection === 'open') finish({ type: 'open', socket: sock });
        if (connection === 'close') {
          const status = lastDisconnect?.error?.output?.statusCode;
          lastError = lastDisconnect?.error || new Error('WhatsApp connection closed');
          if (status === DisconnectReason.loggedOut) {
            finish({ type: 'fatal', error: new Error('WhatsApp logged out this session. Remove the old linked device and pair again.') });
          } else {
            finish({ type: 'retry', error: lastError, status });
          }
        }
      });
    });

    if (outcome.type === 'open') {
      linkedSocket = outcome.socket;
      break;
    }
    try { await sock?.end(undefined); } catch {}
    if (outcome.type === 'fatal') throw outcome.error;
    if (Date.now() < deadline && attempts < 5) {
      console.log('WhatsApp connection is refreshing. Retrying pairing connection (' + (attempts + 1) + '/5)...');
      await sleep(2500);
    }
  }

  if (!linkedSocket) {
    throw new Error('WhatsApp did not confirm the linked session within 5 minutes. ' +
      (lastError?.message || 'Run the workflow again and enter the latest pairing code promptly.'));
  }

  try {
    await sleep(5000);
    if (!state.creds.registered) {
      throw new Error('WhatsApp connection opened but registration was not saved. Please run pairing again.');
    }
    fs.writeFileSync(path.join(path.dirname(sessionDir), 'SESSION_INFO.txt'),
      'BRITECH MD session created: ' + new Date().toISOString() + '\nAuth folder: ' + sessionDir + '\nKeep the entire auth folder private. Never commit or share it.\n');
    console.log('\nWhatsApp linked successfully. Authentication files saved.');
    console.log('The workflow will now create your encrypted SESSION_ID artifact.');
  } finally {
    try { await linkedSocket.end(undefined); } catch {}
    rl.close();
  }
})().then(() => process.exit(0)).catch(error => {
  console.error('\nSession generation failed:', error.message || error);
  rl.close();
  process.exit(1);
});
