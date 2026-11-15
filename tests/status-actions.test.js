const assert = require('node:assert/strict');
const test = require('node:test');
const config = require('../lib/config');
const { STATUS_JID, selectStatusEmoji, handleStatusMessage } = require('../lib/status-actions');
const { dispatchUpsert } = require('../lib/message-dispatcher');

const silentLogger = { warn() {}, error() {} };

test('status viewing and liking are enabled by default with configured emoji choices', () => {
  assert.equal(config.autoViewStatus, true);
  assert.equal(config.autoLikeStatus, true);
  assert.equal(config.statusLikeEmoji, '❤️');
  assert.deepEqual(config.statusLikeEmojis, ['❤️', '🥰', '🌺', '💕', '💥', '🙏', '🔥']);
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
  const settings = { autoViewStatus: true, autoLikeStatus: true, statusLikeEmojis: config.statusLikeEmojis };
  const result = await handleStatusMessage(sock, { key, message: { conversation: 'status body' } }, settings, silentLogger);
  assert.deepEqual(reads, [[key]]);
  assert.equal(sends.length, 1);
  assert.equal(sends[0][0], STATUS_JID);
  const reaction = sends[0][1].react.text;
  assert.ok(config.statusLikeEmojis.includes(reaction));
  assert.deepEqual(sends[0][1].react, { text: reaction, key });
  assert.deepEqual(sends[0][2].statusJidList, [key.participant, sock.user.id]);
  assert.deepEqual({ handled: result.handled, viewed: result.viewed, liked: result.liked }, { handled: true, viewed: true, liked: true });

  const duplicate = await handleStatusMessage(sock, { key }, settings, silentLogger);
  assert.equal(duplicate.liked, true);
  assert.equal(sends.length, 1, 'duplicate upserts should not send repeated reactions');
  assert.equal(reads.length, 1, 'a successfully viewed status should not be sent repeatedly');
});

test('status emoji choice is deterministic per status and supports legacy single-emoji config', () => {
  const key = { participant: '254700000011@s.whatsapp.net', id: 'emoji-choice-test' };
  const choices = ['❤️', '🥰', '🌺', '💕', '💥', '🙏', '🔥'];
  const selected = selectStatusEmoji(key, { statusLikeEmojis: choices });
  assert.ok(choices.includes(selected));
  assert.equal(selectStatusEmoji(key, { statusLikeEmojis: choices }), selected);
  const represented = new Set(Array.from({ length: 250 }, (_, index) => selectStatusEmoji({ ...key, id: `emoji-choice-${index}` }, { statusLikeEmojis: choices })));
  assert.deepEqual(represented, new Set(choices), 'status IDs should rotate through all configured emoji choices');
  assert.equal(selectStatusEmoji(key, { statusLikeEmoji: '🌺' }), '🌺');
  assert.equal(selectStatusEmoji(key, { statusLikeEmojis: [] }), '❤️');
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

test('failed auto-reaction can be retried with the same selected emoji on a later status upsert', async () => {
  let sendCount = 0;
  const sentEmojis = [];
  const sock = {
    user: { id: '254700000099@s.whatsapp.net' },
    async readMessages() {},
    async sendMessage(_jid, content) { sentEmojis.push(content.react.text); sendCount++; if (sendCount === 1) throw new Error('temporary send error'); }
  };
  const key = { remoteJid: STATUS_JID, id: 'britech-status-test-retry', participant: '254700000014@s.whatsapp.net' };
  const settings = { autoViewStatus: false, autoLikeStatus: true, statusLikeEmojis: config.statusLikeEmojis };
  const first = await handleStatusMessage(sock, { key }, settings, silentLogger);
  assert.equal(first.liked, false);
  const second = await handleStatusMessage(sock, { key }, settings, silentLogger);
  assert.equal(second.liked, true);
  assert.equal(sendCount, 2);
  assert.equal(sentEmojis[0], sentEmojis[1]);
});

test('failed automatic status viewing retries on a later event and deduplicates after success', async () => {
  let readCount = 0;
  const key = { remoteJid: STATUS_JID, id: 'britech-status-read-retry', participant: '254700000015@s.whatsapp.net' };
  const sock = { async readMessages() { readCount++; if (readCount === 1) throw new Error('temporary read error'); } };
  const settings = { autoViewStatus: true, autoLikeStatus: false };
  assert.equal((await handleStatusMessage(sock, { key }, settings, silentLogger)).viewed, false);
  assert.equal((await handleStatusMessage(sock, { key }, settings, silentLogger)).viewed, true);
  assert.equal((await handleStatusMessage(sock, { key }, settings, silentLogger)).viewed, true);
  assert.equal(readCount, 2);
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
  await dispatchUpsert(sock, [{ key: { remoteJid: '254700000002@s.whatsapp.net' } }], 'append', {}, silentLogger, handlers);
  assert.deepEqual(calls, [['status', 'status-a'], ['command', '254700000001@s.whatsapp.net'], ['status', 'old-status']]);
});

test('slow automatic status handling does not serialize command replies in the same upsert batch', async () => {
  let releaseStatus;
  let commandStarted = false;
  const slowStatus = new Promise(resolve => { releaseStatus = resolve; });
  const processing = dispatchUpsert({}, [
    { key: { remoteJid: STATUS_JID, id: 'slow-status' } },
    { key: { remoteJid: '254700000003@s.whatsapp.net', id: 'quick-command' } }
  ], 'notify', {}, silentLogger, {
    async handleStatusMessage() { await slowStatus; },
    async handleMessage() { commandStarted = true; }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commandStarted, true, 'command work should begin without waiting for status actions');
  releaseStatus();
  await processing;
});
