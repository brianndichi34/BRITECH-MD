'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const JSZip = require('jszip');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'pairing-web/index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'pairing-server.js'), 'utf8');
const sender = fs.readFileSync(path.join(root, 'send-session.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/session.yml'), 'utf8');
const pairingSession = require(path.join(root, 'lib/pairing-session'));
const sessionIdLoader = require(path.join(root, 'lib/session-id'));

test('pairing dashboard has separate phone and code displays with a code-copy action', () => {
  assert.match(dashboard, /id="pairedPhone"/);
  assert.match(dashboard, /id="code"/);
  assert.match(dashboard, /id="copy"[^>]*>Copy Pair Code/);
  assert.match(dashboard, /navigator\.clipboard\.writeText\(\$\('code'\)\.textContent\)/);
  assert.match(server, /phone: pairingPhone, code: pairingCode/);
});

test('session sender verifies the target number through the full paired identity', () => {
  assert.match(sender, /getVerifiedRecipient\(phone, state\.creds\.me\)/);
  assert.doesNotMatch(sender, /phone \+ '@s\.whatsapp\.net'/);
  assert.match(server, /getVerifiedRecipient\(number, state\.creds\.me\)/);
});

test('README documents secret handling and copyable SESSION_ID delivery', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /separate plain-text WhatsApp message/);
  assert.match(readme, /Word document/i);
  assert.match(readme, /long-press that message to copy it/i);
  assert.match(readme, /Keep the pairing code and run access private/);
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
  assert.equal(pairingSession.getVerifiedRecipient('254712345678', { id: '123456789012345:2@lid', jid: '254712345678@s.whatsapp.net' }), '123456789012345@lid');
  assert.equal(pairingSession.getVerifiedRecipient('254712345678', { id: '123456789012345@hosted.lid', jid: '254712345678@hosted' }), '123456789012345@hosted.lid');
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

test('web pairing exports all auth files into the compact importable archive format', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'britech-auth-source-'));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'britech-auth-target-'));
  try {
    fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify({ registered: true, me: { id: '254712345678@s.whatsapp.net' } }));
    fs.mkdirSync(path.join(authDir, 'keys'));
    fs.writeFileSync(path.join(authDir, 'keys', 'pre-key.json'), '{"key":"data"}');
    const sessionId = await pairingSession.createAuthArchiveSessionId(authDir);
    assert.match(sessionId, /^BRITECH2:/);
    const result = await sessionIdLoader.hydrateSessionId(sessionId, targetDir);
    assert.equal(result.format, 'BRITECH2');
    assert.equal(fs.readFileSync(path.join(targetDir, 'keys', 'pre-key.json'), 'utf8'), '{"key":"data"}');
  } finally {
    fs.rmSync(authDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test('Word document contains the complete SESSION_ID and delivery sends it before text', async () => {
  const sessionId = 'BRITECH2:abc+/=XYZ';
  const document = await pairingSession.createSessionDocx(sessionId);
  const docx = await JSZip.loadAsync(document);
  const documentXml = await docx.file('word/document.xml').async('string');
  assert.match(documentXml, /BRITECH MD SESSION_ID/);
  assert.match(documentXml, /BRITECH2:abc\+\/=XYZ/);

  const sent = [];
  const fakeSocket = { async sendMessage(jid, payload) { sent.push({ jid, payload }); return { key: { id: `message-${sent.length}` } }; } };
  const result = await pairingSession.deliverSession(fakeSocket, '254712345678@s.whatsapp.net', sessionId);
  assert.equal(sent[0].payload.fileName, 'BRITECH-MD-SESSION_ID.docx');
  assert.equal(sent[0].payload.mimetype, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(sent[1].payload.text.includes('SESSION_ID'), true);
  assert.equal(sent[2].payload.text, sessionId);
  assert.equal(result.textSent, true);
});

test('text delivery failure still leaves an acknowledged Word document', async () => {
  const sent = [];
  const fakeSocket = { async sendMessage(_jid, payload) {
    sent.push(payload);
    if (sent.length === 3) throw new Error('message too long');
    return { key: { id: `message-${sent.length}` } };
  } };
  const result = await pairingSession.deliverSession(fakeSocket, '254712345678@s.whatsapp.net', 'BRITECH2:large-payload');
  assert.equal(sent[0].fileName, 'BRITECH-MD-SESSION_ID.docx');
  assert.equal(result.documentId, 'message-1');
  assert.equal(result.textSent, false);
  assert.match(result.textError, /message too long/);
});

test('GitHub Actions makes a compact archive ID and does not hide delivery outcomes', () => {
  assert.match(workflow, /createArchiveSessionId/);
  assert.match(workflow, /zip -9 -qr/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
  assert.match(sender, /deliverSession\(sock, recipient, sessionId\)/);
  assert.match(server, /deliverSession\(sock, recipient, sessionId\)/);
  assert.match(dashboard, /Word document sent/);
});
