'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const JSZip = require('jszip');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'pairing-web/index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'pairing-server.js'), 'utf8');
const sender = fs.readFileSync(path.join(root, 'send-session.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/session.yml'), 'utf8');
const pairingSession = require(path.join(root, 'lib/pairing-session'));
const sessionIdLoader = require(path.join(root, 'lib/session-id'));
const dashboardAccess = require(path.join(root, 'lib/dashboard-access'));

test('pairing dashboard has separate phone and code displays with a code-copy action', () => {
  assert.match(dashboard, /id="pairedPhone"/);
  assert.match(dashboard, /id="code"/);
  assert.match(dashboard, /id="copy"[^>]*>[\s\S]*?Copy code/);
  assert.match(dashboard, /navigator\.clipboard\.writeText\(code\)/);
  assert.match(server, /phone: pairingPhone, code: pairingCode/);
});

test('pairing page has a responsive Orbit-inspired pairing dashboard and clear six-step guide', () => {
  assert.match(dashboard, /Your mini bot/);
  assert.match(dashboard, /Link your WhatsApp/);
  assert.match(dashboard, /HOW IT WORKS/);
  assert.match(dashboard, /Link with phone number instead/);
  assert.match(dashboard, /SESSION_ID delivery/);
  assert.match(dashboard, /paired number.s WhatsApp DM/);
  assert.match(dashboard, /@media \(max-width: 700px\)/);
  assert.match(dashboard, /id="generate"/);
  assert.match(dashboard, /id="statusText"/);
  assert.match(dashboard, /fetch\(path/);
  assert.match(dashboard, /api\('\/api\/pair\/start'/);
  assert.match(dashboard, /api\('\/api\/pair\/status'/);
  assert.match(dashboard, /headers\.Authorization = `Bearer \$\{token\(\)\}`/);
  assert.match(dashboard, /Remember token on this device/);
  assert.match(dashboard, /Forget\/Clear token/);
  assert.match(dashboard, /localStorage\.getItem\(TOKEN_STORAGE_KEY\)/);
  assert.match(dashboard, /localStorage\.setItem\(TOKEN_STORAGE_KEY, token\(\)\)/);
  assert.match(dashboard, /localStorage\.removeItem\(TOKEN_STORAGE_KEY\)/);
  assert.match(dashboard, /headers\.Authorization = `Bearer \$\{token\(\)\}`/);
  assert.match(dashboard, /\.menu/);
});

test('dashboard tabs activate the correct protected flow without a second token prompt', () => {
  assert.match(dashboard, /id="pairCodeTab"[^>]*aria-selected="true"/);
  assert.match(dashboard, /id="sessionIdTab"[^>]*aria-selected="false"/);
  assert.match(dashboard, /setActiveTab\(tab\)/);
  assert.match(dashboard, /localStorage\.getItem\(TOKEN_STORAGE_KEY\)/);
  assert.match(dashboard, /localStorage\.setItem\(TOKEN_STORAGE_KEY, token\(\)\)/);
  assert.match(dashboard, /sessionIdTab.*navigateOrActivate\('session'\)/s);
  assert.match(dashboard, /Generate Session ID/);
  assert.match(dashboard, /api\('\/api\/session\/status'/);
  const sessionRoute = server.match(/url\.pathname === '\/api\/session\/status'[\s\S]*?(?=if \(req\.method === 'GET' && url\.pathname === '\/api\/pair\/status')/)?.[0] || '';
  assert.match(sessionRoute, /sessionSent: pairSessionSent/);
  assert.match(sessionRoute, /documentSent: pairDocumentSent/);
  assert.doesNotMatch(sessionRoute, /code: pairingCode/);
});

test('dashboard supports explicit public and protected access modes', () => {
  assert.equal(dashboardAccess.isProtected(''), false);
  assert.equal(dashboardAccess.isProtected('   '), false);
  assert.equal(dashboardAccess.isAuthorized('', undefined), true);
  assert.equal(dashboardAccess.isAuthorized('', 'Bearer anything'), true);
  assert.equal(dashboardAccess.isProtected('private-token'), true);
  assert.equal(dashboardAccess.isAuthorized('private-token', undefined), false);
  assert.equal(dashboardAccess.isAuthorized('private-token', 'Bearer wrong-token'), false);
  assert.equal(dashboardAccess.isAuthorized('private-token', 'Bearer private-token'), true);
  assert.match(server, /url\.pathname === '\/api\/config'/);
  assert.match(server, /protected: isProtected\(TOKEN\)/);
  assert.match(dashboard, /document\.body\.classList\.toggle\('access-public', !protectedMode\)/);
  assert.match(dashboard, /\.access-public \.token-field/);
  assert.match(dashboard, /if \(protectedMode && token\(\)\) headers\.Authorization/);
});

test('dashboard navigation stays local and never starts a Manus workflow or task', () => {
  assert.match(dashboard, /id="pairCodeTab" class="flow-tab" type="button"/);
  assert.match(dashboard, /id="sessionIdTab" class="flow-tab" type="button"/);
  assert.match(dashboard, /function navigateOrActivate\(tab\)/);
  assert.match(dashboard, /window\.location\.assign\(target\.href\)/);
  assert.match(dashboard, /history\.replaceState\(null, '', hash\)/);
  assert.doesNotMatch(dashboard, /window\.open|formaction|task\.create|manus\.ai|Manus workflow/i);
  assert.match(server, /PAIRING_DASHBOARD_URL/);
  assert.match(server, /pairingUrl: PAIRING_DASHBOARD_URL/);
  assert.match(fs.readFileSync(path.join(root, '.env.example'), 'utf8'), /PAIRING_DASHBOARD_URL=/);
});

test('session sender verifies the target number through the full paired identity', () => {
  assert.match(sender, /getVerifiedRecipient\(phone, state\.creds\.me\)/);
  assert.doesNotMatch(sender, /phone \+ '@s\.whatsapp\.net'/);
  assert.match(server, /getVerifiedRecipient\(number, state\.creds\.me\)/);
  assert.match(server, /sessionDeliveryAcknowledged: pairSessionSent/);
  assert.match(server, /documentSent: pairDocumentSent/);
  assert.match(server, /sendConnectionWelcome\(sock, config\.welcomeMessage/);
  assert.match(server, /welcomeSent: pairWelcomeSent/);
  assert.match(fs.readFileSync(path.join(root, 'Procfile'), 'utf8'), /web: npm start/);
  assert.match(fs.readFileSync(path.join(root, 'lib/health-server.js'), 'utf8'), /\/healthz/);
});

test('README documents secret handling and copyable SESSION_ID delivery', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(readme, /at most two.*Word document.*plain-text message/i);
  assert.match(readme, /Word document/i);
  assert.match(readme, /Open the Word file or copy the plain-text value/i);
  assert.match(readme, /Keep the pairing code and run access private/);
  assert.match(readme, /explicit \*\*public mode\*\*/i);
  assert.match(readme, /anyone who can reach the deployed dashboard can pair/i);
  assert.match(readme, /set a long random token/i);
  assert.match(readme, /Generate Session ID/);
  assert.match(readme, /do not create or start a Manus workflow or task/i);
  assert.match(envExample, /Leave empty for explicit public mode/);
  assert.match(envExample, /^PAIRING_DASHBOARD_TOKEN=\s*$/m);
  assert.match(envExample, /^PAIRING_DASHBOARD_URL=\s*$/m);
});

test('dashboard creates a legacy BRITECH credentials SESSION_ID', () => {
  const creds = { registered: true, me: { id: '254712345678:4@s.whatsapp.net' }, noiseKey: { private: 'test' } };
  const sessionId = pairingSession.createSessionId(creds);
  assert.match(sessionId, /^BRITECH:~/);
  const decoded = JSON.parse(zlib.inflateSync(Buffer.from(sessionId.slice('BRITECH:~'.length), 'base64')).toString('utf8'));
  assert.deepEqual(decoded, creds);
});

test('dashboard only sends to the account whose PN alias matches the entered number', () => {
  assert.equal(pairingSession.getVerifiedRecipient('254712345678', { id: '254712345678:4@s.whatsapp.net' }), '254712345678@s.whatsapp.net');
  assert.throws(() => pairingSession.getVerifiedRecipient('254712345678', { id: '254700000000:4@s.whatsapp.net' }), /cannot be verified.*No session was sent/);
  assert.throws(() => pairingSession.getVerifiedRecipient('254712345678', { id: '123456789012345@lid' }), /cannot be verified.*No session was sent/);
  assert.match(server, /createAuthArchiveSessionId\(SESSION_DIR\)/);
});

test('JID resolver normalizes phone, legacy c.us, hosted and mapped LID identities', () => {
  assert.equal(pairingSession.getVerifiedRecipient('254712345678', { id: '254712345678:4@s.whatsapp.net' }), '254712345678@s.whatsapp.net');
  assert.equal(pairingSession.getVerifiedRecipient('254712345678', { id: '254712345678@c.us' }), '254712345678@s.whatsapp.net');
  assert.equal(pairingSession.getVerifiedRecipient('254712345678', { id: '254712345678@hosted' }), '254712345678@hosted');
  assert.equal(pairingSession.getVerifiedRecipient('254712345678', { id: '123456789012345:2@lid', jid: '254712345678@s.whatsapp.net' }), '254712345678@s.whatsapp.net');
  assert.equal(pairingSession.getVerifiedRecipient('254712345678', { id: '123456789012345@hosted.lid', jid: '254712345678@hosted' }), '254712345678@hosted');
});

test('JID resolver rejects group, broadcast, newsletter and status addresses', () => {
  for (const id of ['123-456@g.us', '123456@broadcast', '123456@newsletter', 'status@broadcast']) {
    assert.throws(() => pairingSession.getVerifiedRecipient('254712345678', { id, jid: '254712345678@s.whatsapp.net' }), /not a supported direct user address/);
  }
});

test('archive SESSION_ID is compact, versioned and imports the full auth folder', async () => {
  const zip = new JSZip();
  const creds = JSON.stringify({ registered: true, me: { id: '254712345678:4@s.whatsapp.net' } });
  zip.file('session/auth/creds.json', creds);
  zip.file('session/auth/keys/pre-key-1.json', '{"test":true}');
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  const sessionId = pairingSession.createArchiveSessionId(archive);
  assert.match(sessionId, /^BRITECH2:/);
  assert.ok(sessionId.length < archive.toString('base64').length, 'compact SESSION_ID should be shorter than the old base64 ZIP value');
  const decodedArchive = zlib.inflateRawSync(Buffer.from(sessionId.slice('BRITECH2:'.length), 'base64url'));
  assert.deepEqual(decodedArchive, archive);

  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'britech-session-'));
  try {
    const result = await sessionIdLoader.hydrateSessionId(sessionId, sessionDir);
    assert.equal(result.format, 'BRITECH2');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8')).registered, true);
    assert.equal(fs.readFileSync(path.join(sessionDir, 'keys/pre-key-1.json'), 'utf8'), '{"test":true}');
  } finally { fs.rmSync(sessionDir, { recursive: true, force: true }); }
});

test('archive SESSION_ID importer blocks path traversal and preserves old full ZIP IDs', async () => {
  const zip = new JSZip();
  zip.file('session/auth/creds.json', JSON.stringify({ registered: true, me: { id: '254712345678@s.whatsapp.net' } }));
  const legacyZip = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'britech-legacy-'));
  try {
    const result = await sessionIdLoader.hydrateSessionId(legacyZip.toString('base64'), tmp);
    assert.equal(result.format, 'legacy-zip');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  const unsafe = new JSZip();
  unsafe.file('session/auth/creds.json', JSON.stringify({ registered: true, me: { id: '254712345678@s.whatsapp.net' } }));
  unsafe.file('session/auth/../../escape.txt', 'bad');
  const unsafeArchive = await unsafe.generateAsync({ type: 'nodebuffer' });
  const unsafeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'britech-unsafe-'));
  try {
    await assert.rejects(sessionIdLoader.hydrateSessionId(unsafeArchive.toString('base64'), unsafeDir), /outside the auth folder/);
    assert.equal(fs.existsSync(path.join(unsafeDir, 'creds.json')), false);
  } finally { fs.rmSync(unsafeDir, { recursive: true, force: true }); }
});

test('web pairing exports full auth data as a shorter BRITECH3 ID and the bot imports it', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'britech-auth-source-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'britech-auth-target-'));
  try {
    fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify({ registered: true, me: { id: '254712345678@s.whatsapp.net' } }));
    fs.mkdirSync(path.join(authDir, 'keys'));
    for (let i = 0; i < 60; i++) {
      fs.writeFileSync(path.join(authDir, 'keys', `pre-key-${i}.json`), JSON.stringify({ keyId: i, keyData: 'repeated-auth-key-material-'.repeat(30) }));
    }
    const sessionId = await pairingSession.createAuthArchiveSessionId(authDir);
    assert.match(sessionId, /^BRITECH3:/);
    const oldZip = new JSZip();
    for (const name of fs.readdirSync(authDir, { recursive: true })) {
      const fullPath = path.join(authDir, name);
      if (fs.statSync(fullPath).isFile()) oldZip.file(`session/auth/${name.replace(/\\/g, '/')}`, fs.readFileSync(fullPath));
    }
    const oldArchive = await oldZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    const oldId = pairingSession.createArchiveSessionId(oldArchive);
    assert.ok(sessionId.length < oldId.length, `BRITECH3 (${sessionId.length}) should be shorter than BRITECH2 (${oldId.length})`);
    const result = await sessionIdLoader.hydrateSessionId(sessionId, targetDir);
    assert.equal(result.format, 'BRITECH3');
    assert.equal(fs.readFileSync(path.join(targetDir, 'keys', 'pre-key-12.json'), 'utf8'), JSON.stringify({ keyId: 12, keyData: 'repeated-auth-key-material-'.repeat(30) }));
  } finally {
    fs.rmSync(authDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('truncated BRITECH3 values produce an actionable deployment error', () => {
  const valid = sessionIdLoader.createCompactSessionId([
    { path: 'creds.json', data: JSON.stringify({ registered: true, me: { id: '254712345678@s.whatsapp.net' } }) }
  ]);
  assert.throws(
    () => sessionIdLoader.decodeCompactSessionId(valid.slice(0, -4)),
    /BRITECH3 payload is truncated or corrupted.*complete one-line value/i
  );
});

test('Word document contains the complete SESSION_ID and delivery sends at most two messages', async () => {
  const sessionId = 'BRITECH2:abc+/=XYZ';
  const document = await pairingSession.createSessionDocx(sessionId);
  const docx = await JSZip.loadAsync(document);
  const documentXml = await docx.file('word/document.xml').async('string');
  assert.match(documentXml, /BRITECH-NB SESSION_ID/);
  assert.match(documentXml, /BRITECH2:abc\+\/=XYZ/);

  const sent = [];
  const ev = new EventEmitter();
  const fakeSocket = { ev, async sendMessage(jid, payload) {
    sent.push({ jid, payload });
    const id = `message-${sent.length}`;
    queueMicrotask(() => ev.emit('messages.update', [{ key: { id }, update: { status: 2 } }]));
    return { key: { id } };
  } };
  const result = await pairingSession.deliverSession(fakeSocket, '254712345678@s.whatsapp.net', sessionId);
  assert.equal(sent[0].payload.fileName, 'BRITECH-MD-SESSION_ID.docx');
  assert.equal(sent[0].payload.mimetype, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].payload.text, sessionId);
  assert.equal(sent.every(item => item.jid === '254712345678@s.whatsapp.net'), true);
  assert.equal(result.documentSent, true);
  assert.equal(result.sessionSent, true);
  assert.equal(result.textSent, true);
  await assert.rejects(pairingSession.deliverSession(fakeSocket, '254712345678@s.whatsapp.net', sessionId), /already started/);
});

test('single-document delivery failure is reported, and local message creation is not treated as server acknowledgement', async () => {
  const sent = [];
  const ev = new EventEmitter();
  const fakeSocket = { ev, async sendMessage(_jid, payload) {
    sent.push(payload);
    const id = `message-${sent.length}`;
    throw new Error('document rejected');
    return { key: { id } };
  } };
  await assert.rejects(pairingSession.deliverSession(fakeSocket, '254712345678@s.whatsapp.net', 'BRITECH2:large-payload'), /document rejected/);
  const unacked = await pairingSession.sendAndConfirm({ ev: new EventEmitter(), async sendMessage() { return { key: { id: 'local-only' } }; } }, '254712345678@s.whatsapp.net', { text: 'not acked' }, 5);
  assert.deepEqual(unacked, { id: 'local-only', acknowledged: false });
});

test('long SESSION_ID text is sent in pasteable ordered chunks under WhatsApp message size limits', () => {
  const id = 'BRITECH3:' + 'x'.repeat(25001);
  const [notice, ...parts] = pairingSession.createDeliveryMessages(id);
  assert.match(notice, /join them with no spaces or line breaks/);
  assert.equal(parts.join(''), id);
  assert.ok(parts.every(part => part.length <= 12000));
});

test('GitHub Actions makes a compact archive ID and does not hide delivery outcomes', () => {
  assert.match(workflow, /createAuthArchiveSessionId/);
  assert.match(workflow, /zip -9 -qr/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
  assert.match(sender, /deliverSession\(sock, recipient, sessionId\)/);
  assert.match(server, /deliverSession\(sock, recipient, sessionId\)/);
  assert.match(sender, /SESSION_ID delivery acknowledged/i);
  assert.match(dashboard, /at most two messages.*Word document.*plain-text value/i);
  assert.match(dashboard, /acknowledged/i);
  assert.match(dashboard, /welcome message/);
});

test('pairing-code retries discard partial auth state before a fresh attempt', () => {
  const generator = fs.readFileSync(path.join(root, 'generate-session.js'), 'utf8');
  assert.match(generator, /useMultiFileAuthState\(sessionDir\)/);
  assert.match(generator, /!state\.creds\.registered/);
  assert.match(generator, /fs\.rmSync\(sessionDir, \{ recursive: true, force: true \}\)/);
});

test('pairing-code requests wait for Baileys initial QR handshake', () => {
  const generator = fs.readFileSync(path.join(root, 'generate-session.js'), 'utf8');
  assert.match(generator, /const \{ connection, qr, lastDisconnect \} = update/);
  assert.match(generator, /if \(qr && !state\.creds\.registered\)/);
  assert.match(generator, /browser: Browsers\.macOS\('Chrome'\)/);
  assert.doesNotMatch(generator, /Browsers\.macOS\('Desktop'\)/);
  assert.doesNotMatch(generator, /printQRInTerminal/);
  assert.match(server, /const \{ connection, qr \} = update/);
  assert.match(server, /if \(qr && !pairingCode && !state\.creds\.registered\)/);
  assert.doesNotMatch(server, /if \(update\.connection === 'connecting' && !pairingCode/);
});

test('pairing accepts common international display formats without changing the number', () => {
  assert.equal(pairingSession.normalizePhone('+254 712-345-678'), '254712345678');
  assert.equal(pairingSession.normalizePhone('254 (712) 345 678'), '254712345678');
  assert.equal(pairingSession.normalizePhone('00 254 712 345 678'), '254712345678');
});

test('KataBump guidance explains downloading, extracting, creating, editing, and saving a private .env', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /Download a fresh project ZIP/);
  assert.match(readme, /upload the project ZIP/);
  assert.match(readme, /New File/);
  assert.match(readme, /Press \*\*Save\*\*/);
  assert.match(readme, /SESSION_ID=BRITECH3:/);
  const template = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(template, /^SESSION_ID=\s*$/m);
});
