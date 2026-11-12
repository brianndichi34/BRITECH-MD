'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dashboard = fs.readFileSync(path.join(root, 'pairing-web/index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'pairing-server.js'), 'utf8');
const sender = fs.readFileSync(path.join(root, 'send-session.js'), 'utf8');

test('pairing dashboard has separate phone and code displays with a code-copy action', () => {
  assert.match(dashboard, /id="pairedPhone"/);
  assert.match(dashboard, /id="code"/);
  assert.match(dashboard, /id="copy"[^>]*>Copy Pair Code/);
  assert.match(dashboard, /navigator\.clipboard\.writeText\(\$\('code'\)\.textContent\)/);
  assert.match(server, /phone: pairingPhone, code: pairingCode/);
});

test('session sender verifies the target number matches the paired account before sending', () => {
  assert.match(sender, /accountNumber !== phone/);
  assert.match(sender, /if \(accountNumber !== phone\)[\s\S]*?throw new Error/);
  assert.match(sender, /const recipient = phone \+ '@s\.whatsapp\.net'/);
});

test('session sender emits the session ID as a separate plain-text WhatsApp message', () => {
  assert.match(sender, /text: 'BRITECH MD SESSION_ID\\nCopy the next message/);
  assert.match(sender, /sendMessage\(recipient, \{ text: sessionId \}\)/);
  assert.doesNotMatch(sender, /sendMessage\(recipient, \{ document:/);
  assert.match(sender, /SESSION_ID delivered as plain copyable text/);
});

test('pairing documentation warns users to keep session data private and describes direct text copying', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /separate plain-text WhatsApp message/);
  assert.match(readme, /long-press that message to copy/);
  assert.match(readme, /Keep the pairing code and run access private/);
});
