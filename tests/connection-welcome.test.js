const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sendConnectionWelcome } = require('../lib/connection-welcome');

const message = 'WELCOME TO BRITECH BOT🔥💯\nFOUNDED BY BRIAN N.🌺';
const silentLogger = { info() {}, warn() {}, error() {} };

async function withStateDir(run) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'britech-connect-welcome-'));
  try {
    await run(stateDir);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

test('connection welcome goes to the paired account self-chat once and persists across device reconnects', async () => {
  await withStateDir(async stateDir => {
    const sent = [];
    const sock = {
      user: { id: '254700000099:2@s.whatsapp.net' },
      async sendMessage(...args) { sent.push(args); return { key: { id: 'welcome-1' } }; }
    };

    assert.deepEqual(await sendConnectionWelcome(sock, message, { stateDir, logger: silentLogger }), { sent: true });
    assert.deepEqual(await sendConnectionWelcome({ ...sock, user: { id: '254700000099:16@s.whatsapp.net' } }, message, { stateDir, logger: silentLogger }), { sent: false, reason: 'already-sent' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], '254700000099:2@s.whatsapp.net');
    assert.deepEqual(sent[0][1], { text: message });
  });
});

test('connection welcome retries after a failed send and deduplicates after success', async () => {
  await withStateDir(async stateDir => {
    let attempts = 0;
    const sock = {
      user: { id: '254700000099@s.whatsapp.net' },
      async sendMessage() {
        attempts++;
        if (attempts === 1) throw new Error('temporary send failure');
        return { key: { id: 'welcome-2' } };
      }
    };

    assert.deepEqual(await sendConnectionWelcome(sock, message, { stateDir, logger: silentLogger }), { sent: false, reason: 'send-failed' });
    assert.deepEqual(await sendConnectionWelcome(sock, message, { stateDir, logger: silentLogger }), { sent: true });
    assert.deepEqual(await sendConnectionWelcome(sock, message, { stateDir, logger: silentLogger }), { sent: false, reason: 'already-sent' });
    assert.equal(attempts, 2);
  });
});

test('connection welcome skips safely when the message or paired account identity is unavailable', async () => {
  let attempts = 0;
  const sock = { user: {}, async sendMessage() { attempts++; } };
  assert.deepEqual(await sendConnectionWelcome(sock, '', { logger: silentLogger }), { sent: false, reason: 'message-not-configured' });
  assert.deepEqual(await sendConnectionWelcome(sock, message, { logger: silentLogger }), { sent: false, reason: 'account-identity-unavailable' });
  assert.equal(attempts, 0);
});
