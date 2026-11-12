'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'pairing-web/index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'pairing-server.js'), 'utf8');
const sender = fs.readFileSync(path.join(root, 'send-session.js'), 'utf8');
const pairingSession = require(path.join(root, 'lib/pairing-session'));

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

test('session sender emits the session ID as a separate plain-text WhatsApp message', () => {
  assert.match(sender, /createDeliveryMessages\(sessionId\)/);
  assert.match(sender, /sendMessage\(recipient, \{ text: sessionText \}\)/);
  assert.match(sender, /sessionResult\?\.key\?\.id/);
  assert.match(sender, /SESSION_ID was sent separately as copyable text/);
  assert.doesNotMatch(sender, /sendMessage\(recipient, \{ document:/);
});

test('pairing documentation warns users to keep session data private and describes direct text copying', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /separate plain-text WhatsApp message/);
  assert.match(readme, /long-press the standalone message to copy/i);
  assert.match(readme, /Keep the pairing code and run access private/);
});

test('dashboard creates a BRITECH session ID compatible with the bot loader', () => {
  const creds = { registered: true, me: { id: '254712345678:4@s.whatsapp.net' }, noiseKey: { private: 'test' } };
  const sessionId = pairingSession.createSessionId(creds);
  assert.match(sessionId, /^BRITECH:~/);
  const decoded = JSON.parse(zlib.inflateSync(Buffer.from(sessionId.slice('BRITECH:~'.length), 'base64')).toString('utf8'));
  assert.deepEqual(decoded, creds);
});

test('dashboard only sends to the account whose PN alias matches the entered number', () => {
  assert.equal(
    pairingSession.getVerifiedRecipient('254712345678', { id: '254712345678:4@s.whatsapp.net' }),
    '254712345678@s.whatsapp.net'
  );
  assert.throws(
    () => pairingSession.getVerifiedRecipient('254712345678', { id: '254700000000:4@s.whatsapp.net' }),
    /cannot be verified.*No session was sent/
  );
  assert.throws(
    () => pairingSession.getVerifiedRecipient('254712345678', { id: '123456789012345@lid' }),
    /cannot be verified.*No session was sent/
  );
});

test('dashboard sends the SESSION_ID as a standalone text message and reports delivery status', () => {
  const sessionId = 'BRITECH:~dGVzdA==';
  const messages = pairingSession.createDeliveryMessages(sessionId);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /Copy the next message/);
  assert.equal(messages[1], sessionId);
  assert.match(server, /sendMessage\(recipient, \{ text: sessionText \}\)/);
  assert.match(server, /pairStatus = 'sending_session'/);
  assert.match(dashboard, /sending_session/);
  assert.match(dashboard, /SESSION_ID sent as a separate text message/);
  assert.match(dashboard, /startsWith\('WhatsApp linked,'\)/);
  assert.equal(pairingSession.createDeliveryMessages('base64-session-archive')[1], 'base64-session-archive');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/session.yml'), 'utf8');
  assert.match(workflow, /Send plain-text SESSION_ID/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});

test('JID resolver normalizes device-qualified phone JIDs and legacy c.us aliases', () => {
  assert.equal(pairingSession.getVerifiedRecipient('254712345678', { id: '254712345678:4@s.whatsapp.net' }), '254712345678@s.whatsapp.net');
  assert.equal(pairingSession.getVerifiedRecipient('254712345678', { id: '254712345678@c.us' }), '254712345678@s.whatsapp.net');
});

test('JID resolver supports LID and hosted identities when a verified PN alias is present', () => {
  assert.equal(
    pairingSession.getVerifiedRecipient('254712345678', {
      id: '123456789012345:2@lid',
      jid: '254712345678@s.whatsapp.net',
      lid: '123456789012345@lid'
    }),
    '123456789012345@lid'
  );
  assert.equal(
    pairingSession.getVerifiedRecipient('254712345678', {
      id: '123456789012345@hosted.lid',
      jid: '254712345678@hosted'
    }),
    '123456789012345@hosted.lid'
  );
  assert.equal(
    pairingSession.getVerifiedRecipient('254712345678', { id: '254712345678@hosted' }),
    '254712345678@hosted'
  );
});

test('JID resolver rejects groups, broadcasts, newsletters, and status addresses', () => {
  for (const id of ['123-456@g.us', '123456@broadcast', '123456@newsletter', 'status@broadcast']) {
    assert.throws(
      () => pairingSession.getVerifiedRecipient('254712345678', { id, jid: '254712345678@s.whatsapp.net' }),
      /not a supported direct user address/
    );
  }
});
