const assert = require('node:assert/strict');
const test = require('node:test');
const config = require('../lib/config');
const { STATUS_JID, handleStatusMessage } = require('../lib/status-actions');
const { dispatchUpsert } = require('../lib/message-dispatcher');

const silentLogger = { warn() {}, error() {} };

test('status viewing and liking are enabled by default with heart reaction', () => {
  assert.equal(config.autoViewStatus, true);
  assert.equal(config.autoLikeStatus, true);
  assert.equal(config.statusLikeEmoji, '❤️');
});

test('incoming contact status is marked read and reacted to with Baileys statusJidList routing', async () => {
  const key = { remoteJid: STATUS_JID, id: 'britech-status-test-success', participant: '254700000011@s.whatsapp.net' };
  const reads = [];
  const sends = [];
  const sock = {
    user: { id: '254700000099:2@s.whatsapp.net' },
    async readMessages(keys) { reads.push(keys); },
    async sendMessage(...args) { sends.push(args); }
  };
  const result = await handleStatusMessage(sock, { key, message: { conversation: 'status body' } }, {
    autoViewStatus: true, autoLikeStatus: true, statusLikeEmoji: '❤️'
  }, silentLogger);
  assert.deepEqual(reads, [[key]]);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][0], STATUS_JID);
  assert.deepEqual(sends[0][1].react, { text: '❤️', key });
  assert.deepEqual(sends[0][2].statusJidList, [key.participant, sock.user.id]);
  assert.deepEqual({ handled: result.handled, viewed: result.viewed, liked: result.liked }, { handled: true, viewed: true, liked: true });

  const duplicate = await handleStatusMessage(sock, { key }, {
    autoViewStatus: true, autoLikeStatus: true, statusLikeEmoji: '❤️'
  }, silentLogger);
  assert.equal(duplicate.liked, true);
  assert.equal(sends.length, 1, 'duplicate upserts should not send repeated reactions');
  assert.equal(reads.length, 2, 're-marking a status read is safe and idempotent');
});

test('auto-view and auto-like can be disabled independently; self and non-status messages are ignored', async () => {
  let readCount = 0;
  let sendCount = 0;
  const sock = {
    user: { id: '254700000099@s.whatsapp.net' },
    async readMessages() { readCount++; },
    async sendMessage() { sendCount++; }
  };
  const key = { remoteJid: STATUS_JID, id: 'britech-status-test-disabled', participant: '254700000012@s.whatsapp.net' };
  const disabled = await handleStatusMessage(sock, { key }, { autoViewStatus: false, autoLikeStatus: false }, silentLogger);
  assert.deepEqual({ handled: disabled.handled, viewed: disabled.viewed, liked: disabled.liked }, { handled: true, viewed: false, liked: false });
  assert.equal((await handleStatusMessage(sock, { key: { ...key, fromMe: true } }, { autoViewStatus: true, autoLikeStatus: true }, silentLogger)).handled, false);
  assert.equal((await handleStatusMessage(sock, { key: { ...key, remoteJid: '254700000013@s.whatsapp.net' } }, { autoViewStatus: true, autoLikeStatus: true }, silentLogger)).handled, false);
  assert.equal(readCount, 0);
  assert.equal(sendCount, 0);
});

test('failed auto-reaction can be retried on a later status upsert', async () => {
  let sendCount = 0;
  const sock = {
    user: { id: '254700000099@s.whatsapp.net' },
    async readMessages() {},
    async sendMessage() { sendCount++; if (sendCount === 1) throw new Error('temporary send error'); }
  };
  const key = { remoteJid: STATUS_JID, id: 'britech-status-test-retry', participant: '254700000014@s.whatsapp.net' };
  const settings = { autoViewStatus: false, autoLikeStatus: true, statusLikeEmoji: '❤️' };
  const first = await handleStatusMessage(sock, { key }, settings, silentLogger);
  assert.equal(first.liked, false);
  const second = await handleStatusMessage(sock, { key }, settings, silentLogger);
  assert.equal(second.liked, true);
  assert.equal(sendCount, 2);
});

test('upsert dispatcher routes only live status notifications to status actions', async () => {
  const calls = [];
  const sock = {};
  const handlers = {
    async handleMessage(_sock, msg) { calls.push(['command', msg.key.remoteJid]); },
    async handleStatusMessage(_sock, msg) { calls.push(['status', msg.key.id]); }
  };
  await dispatchUpsert(sock, [
    { key: { remoteJid: STATUS_JID, id: 'status-a' } },
    { key: { remoteJid: '254700000001@s.whatsapp.net' } }
  ], 'notify', {}, silentLogger, handlers);
  await dispatchUpsert(sock, [{ key: { remoteJid: STATUS_JID, id: 'old-status' } }], 'append', {}, silentLogger, handlers);
  assert.deepEqual(calls, [['status', 'status-a'], ['command', '254700000001@s.whatsapp.net']]);
});
