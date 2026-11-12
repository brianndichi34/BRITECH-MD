require('dotenv').config();
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = baileys;
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const sessionDir = path.resolve(process.env.SESSION_DIR || './session/auth');
const sessionIdPath = path.resolve(process.env.SESSION_ID_FILE || './SESSION_ID.txt');
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const ciMode = process.argv.includes('--ci') || process.env.CI === 'true';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function publishPairingCode(code) {
  // Keep the one-time code out of stdout / Actions logs.
  fs.writeFileSync(path.join(path.dirname(sessionDir), 'PAIRING_CODE.txt'), code + '\n', { mode: 0o600 });
  if (ciMode) {\n    // GitHub renders this as a run annotation while the pairing step is still active.\n    // This makes the code available before the generator's wait-for-link step completes.\n    console.log('::notice title=BRITECH MD pairing code::' + code);\n  }\n  if (summaryPath) {
    fs.appendFileSync(summaryPath,
      '\n## BRITECH MD pairing code\n\n' +
      '> Use this code immediately in WhatsApp → Linked devices → Link with phone number instead.\n\n' +
      '`' + code + '`\n\n' +
      'This is a one-time code. Do not share screenshots or workflow access.\n');
  }
  if (!ciMode) console.log('Pairing code generated. Check the pairing-code display file; it is not printed in terminal logs.');
}

(async () => {
  console.log('BRITECH MD — WhatsApp session pairing');
  console.log('On your phone: WhatsApp > Linked devices > Link with phone number instead.');

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
  const codeFile = path.join(path.dirname(sessionDir), 'PAIRING_CODE.txt');
  try { fs.rmSync(codeFile, { force: true }); } catch {}
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
      const finish = result => { if (!settled) { settled = true; resolve(result); } };

      sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome')
      });
      sock.ev.on('creds.update', saveCreds);

      const requestCode = async () => {
        if (codeRequested || state.creds.registered) return;
        codeRequested = true;
        try {
          // Baileys expects the socket to be initialized before requesting a phone code.
          await sleep(1500);
          const code = await sock.requestPairingCode(phone);
          publishPairingCode(code);
        } catch (error) {
          lastError = error;
          finish({ type: 'retry', error });
        }
      };

      sock.ev.on('connection.update', update => {
        const { connection, lastDisconnect } = update;
        // Do not depend on a QR event: phone-number pairing can be requested as
        // soon as the socket begins connecting.
        if ((connection === 'connecting' || connection === 'open') && !state.creds.registered) {
          void requestCode();
        }
        if (connection === 'open') finish({ type: 'open', socket: sock });
        if (connection === 'close') {
          const status = lastDisconnect?.error?.output?.statusCode;
          lastError = lastDisconnect?.error || new Error('WhatsApp connection closed');
          if (status === DisconnectReason.loggedOut) {
            finish({ type: 'fatal', error: new Error('WhatsApp logged out this session. Remove the old linked device and pair again.') });
          } else finish({ type: 'retry', error: lastError, status });
        }
      });
    });

    if (outcome.type === 'open') { linkedSocket = outcome.socket; break; }
    try { await sock?.end(undefined); } catch {}
    if (outcome.type === 'fatal') throw outcome.error;
    if (Date.now() < deadline && attempts < 5) await sleep(2500);
  }

  if (!linkedSocket) {
    throw new Error('WhatsApp did not confirm the linked session within 5 minutes. ' +
      (lastError?.message || 'Run the workflow again and enter the newest pairing code promptly.'));
  }

  try {
    await sleep(5000);
    if (!state.creds.registered) throw new Error('WhatsApp connection opened but registration was not saved. Please run pairing again.');
    fs.writeFileSync(path.join(path.dirname(sessionDir), 'SESSION_INFO.txt'),
      'BRITECH MD session created: ' + new Date().toISOString() + '\nAuth folder: ' + sessionDir + '\nKeep the entire auth folder private. Never commit or share it.\n');
    fs.writeFileSync(sessionIdPath, Buffer.from(fs.readFileSync(path.join(sessionDir, 'creds.json'))).toString('base64'));
    console.log('WhatsApp linked successfully. Authentication files saved.');
    console.log('The workflow will now package and encrypt the complete auth folder for SESSION_ID export.');
  } finally {
    try { await linkedSocket.end(undefined); } catch {}
    rl.close();
  }
})().then(() => process.exit(0)).catch(error => {
  console.error('Session generation failed:', error.message || error);
  rl.close();
  process.exit(1);
});
