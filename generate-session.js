require('dotenv').config();
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = baileys;
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');

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
  if (ciMode) {
    // GitHub renders this as a run annotation while the pairing step is still active.
    // This makes the code available before the generator's wait-for-link step completes.
    console.log('::notice title=BRITECH MD pairing code::' + code);
  }
  if (summaryPath) {
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
    const credsPath = path.join(sessionDir, 'creds.json');
    let existing;
    try { existing = JSON.parse(fs.readFileSync(credsPath, 'utf8')); } catch {}
    if (!existing?.registered && existing && process.env.SESSION_REPLACE !== 'YES') {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } else {
      if (process.env.SESSION_REPLACE !== 'YES') {
        throw new Error('An existing auth folder was found. It was NOT changed. Back it up first; set SESSION_REPLACE=YES only if you intentionally want to replace it.');
      }
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }

  let phoneInput = process.env.PHONE_NUMBER || '';
  if (!phoneInput && !ciMode) phoneInput = await ask('WhatsApp number in international format, digits only (e.g. 2547XXXXXXXX): ');
  const phone = String(phoneInput).replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 15) throw new Error('Set a valid international PHONE_NUMBER, e.g. 2547XXXXXXXX.');

  const codeFile = path.join(path.dirname(sessionDir), 'PAIRING_CODE.txt');
  try { fs.rmSync(codeFile, { force: true }); } catch {}
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch {}

  const deadline = Date.now() + 5 * 60 * 1000;
  let attempts = 0;
  let linkedSocket = null;
  let linkedState = null;
  let lastError = null;

  while (Date.now() < deadline && attempts < 5 && !linkedSocket) {
    attempts++;
    fs.mkdirSync(sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
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
        // WhatsApp phone-number linking is more reliable with the desktop
        // profile, including on WhatsApp Business accounts.
        browser: Browsers.macOS('Desktop')
      });
      sock.ev.on('creds.update', saveCreds);

      const requestCode = async () => {
        if (codeRequested || state.creds.registered) return;
        codeRequested = true;
        await sleep(1500);
        for (let attempt = 1; attempt <= 3 && !state.creds.registered; attempt++) {
          try {
            // Baileys expects the socket to be initialized before requesting a phone code.
            const code = await sock.requestPairingCode(phone);
            publishPairingCode(code);
            return;
          } catch (error) {
            lastError = error;
            if (attempt < 3) await sleep(1800);
          }
        }
        finish({ type: 'retry', error: lastError || new Error('Could not request a pairing code.') });
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
            if (!state.creds.registered) {
              finish({ type: 'retry', error: new Error('WhatsApp rejected or expired this pairing code. A fresh code will be generated.') });
            } else {
              finish({ type: 'fatal', error: new Error('WhatsApp logged out this session. Remove the old linked device and pair again.') });
            }
          } else finish({ type: 'retry', error: lastError, status });
        }
      });
    });

    if (outcome.type === 'open') { linkedSocket = outcome.socket; linkedState = state; break; }
    try { await sock?.end(undefined); } catch {}
    if (!state.creds.registered) {
      // A failed request can leave pre-keys and a partial creds.json behind.
      // Never reuse that state for the next pairing-code attempt.
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    if (outcome.type === 'fatal') throw outcome.error;
    if (Date.now() < deadline && attempts < 5) await sleep(2500);
  }

  if (!linkedSocket) {
    throw new Error('WhatsApp did not confirm the linked session within 5 minutes. ' +
      (lastError?.message || 'Run the workflow again and enter the newest pairing code promptly.'));
  }

  try {
    await sleep(5000);
    if (!linkedState?.creds.registered) throw new Error('WhatsApp connection opened but registration was not saved. Please run pairing again.');
    fs.writeFileSync(path.join(path.dirname(sessionDir), 'SESSION_INFO.txt'),
      'BRITECH MD session created: ' + new Date().toISOString() + '\nAuth folder: ' + sessionDir + '\nKeep the entire auth folder private. Never commit or share it.\n');
    // Compressed + prefixed SESSION_ID (shorter, easy to paste on hosts)
    const credsRaw = fs.readFileSync(path.join(sessionDir, 'creds.json'));
    const compressed = zlib.deflateSync(credsRaw);
    fs.writeFileSync(sessionIdPath, 'BRITECH:\~' + compressed.toString('base64'));
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
