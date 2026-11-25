const assert = require('node:assert/strict');
const test = require('node:test');
const config = require('../lib/config');
const { createAntiDelete } = require('../lib/anti-delete');

const WAMessageStubType = { REVOKE: 1 };

const silentLogger = { info() {}, warn() {} };
const ownerNumber = '254717276195';
const pairedJid = '254700000099@s.whatsapp.net';

test('anti-delete is enabled by default in the deployment configuration', () => {
  assert.equal(config.autoAntiDelete, true);
});

test('revoked messages from groups and private chats are sent to the owner DM', async () => {
  const antiDelete = createAntiDelete();
  const sent = [];
  const sock = {
    user: { id: '254700000099:2@s.whatsapp.net' },
    async sendMessage(jid, content) { sent.push({ jid, content }); }
  };
  const groupJid = '120363000000000001@g.us';
  const dmJid = '254700000012@s.whatsapp.net';
  const groupMessage = {
    key: { remoteJid: groupJid, id: 'group-msg-1', participant: '254700000011@s.whatsapp.net', fromMe: false },
    message: { conversation: 'A message deleted in a group' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Group member'
  };
  const dmMessage = {
    key: { remoteJid: dmJid, id: 'dm-msg-1', fromMe: false },
    message: { extendedTextMessage: { text: 'A message deleted in a private chat' } },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };

  assert.equal(antiDelete.remember(sock, [groupMessage, dmMessage], { autoAntiDelete: true, ownerNumber }), 2);
  const updates = [
    {
      key: { remoteJid: groupJid, id: 'group-msg-1', participant: '254700000011@s.whatsapp.net', fromMe: false },
      update: {
        messageStubType: WAMessageStubType.REVOKE,
        key: { remoteJid: groupJid, id: 'group-revoke-1', participant: '254700000013@s.whatsapp.net', fromMe: false }
      }
    },
    {
      key: { remoteJid: dmJid, id: 'dm-msg-1', fromMe: false },
      update: {
        messageStubType: WAMessageStubType.REVOKE,
        key: { remoteJid: dmJid, id: 'dm-revoke-1', fromMe: false }
      }
    }
  ];

  assert.equal(await antiDelete.handleUpdates(sock, updates, { autoAntiDelete: true, ownerNumber }, silentLogger), 2);
  assert.equal(sent.length, 4, 'send a context header and a forwarded original for each deletion');
  assert.ok(sent.every(item => item.jid === pairedJid));
  assert.match(sent[0].content.text, /Group: 120363000000000001@g\.us/);
  assert.match(sent[0].content.text, /Original sender: Group member/);
  assert.equal(sent[1].content.forward.key.id, 'group-msg-1');
  assert.equal(sent[1].content.force, true);
  assert.match(sent[2].content.text, /Chat: 254700000012@s\.whatsapp\.net/);
  assert.equal(sent[3].content.forward.key.id, 'dm-msg-1');
  assert.equal(antiDelete.cacheSize(), 0);
});

test('ordinary updates, owner self-chat, status messages, and status revocations are ignored', async () => {
  const antiDelete = createAntiDelete();
  const sock = { user: { id: pairedJid } };
  const input = [
    { key: { remoteJid: pairedJid, id: 'self-message' }, message: { conversation: 'avoid forwarding loops' } },
    { key: { remoteJid: 'status@broadcast', id: 'status-message' }, message: { conversation: 'not a chat message' } }
  ];
  assert.equal(antiDelete.remember(sock, input, { autoAntiDelete: true, ownerNumber }), 0);
  assert.equal(antiDelete.cacheSize(), 0);
  assert.equal(await antiDelete.handleUpdates({ async sendMessage() { throw new Error('not a revoke'); } }, [
    { key: { remoteJid: '254700000012@s.whatsapp.net', id: 'ordinary' }, update: { status: 3 } }
  ], { autoAntiDelete: true, ownerNumber }, silentLogger), 0);
});

test('status revocation events never generate anti-delete DM notifications', async () => {
  const antiDelete = createAntiDelete();
  let sends = 0;
  const sock = { user: { id: pairedJid }, async sendMessage() { sends++; } };
  const statusRevoke = {
    key: { remoteJid: 'status@broadcast', id: 'status-item-1', participant: '254700000011@s.whatsapp.net' },
    update: { messageStubType: WAMessageStubType.REVOKE, key: { remoteJid: 'status@broadcast', id: 'status-revoke-1' } }
  };
  assert.equal(await antiDelete.handleUpdates(sock, [statusRevoke], { autoAntiDelete: true, ownerNumber }, silentLogger), 0);
  assert.equal(sends, 0);
});

test('cache is bounded and repeated revoke notifications do not forward twice', async () => {
  const antiDelete = createAntiDelete({ maxMessages: 2 });
  const sock = { user: { id: pairedJid }, async sendMessage(jid, content) { sent.push({ jid, content }); } };
  const sent = [];
  const chat = '254700000021@s.whatsapp.net';
  const messages = ['oldest', 'middle', 'newest'].map(id => ({
    key: { remoteJid: chat, id, fromMe: false },
    message: { conversation: id }
  }));
  antiDelete.remember(sock, messages, { autoAntiDelete: true, ownerNumber });
  assert.equal(antiDelete.cacheSize(), 2);
  const revoke = {
    key: { remoteJid: chat, id: 'middle', fromMe: false },
    update: { messageStubType: WAMessageStubType.REVOKE, key: { remoteJid: chat, id: 'revoke-middle' } }
  };
  const settings = { autoAntiDelete: true, ownerNumber };
  assert.equal(await antiDelete.handleUpdates(sock, [revoke], settings, silentLogger), 1);
  assert.equal(await antiDelete.handleUpdates(sock, [revoke], settings, silentLogger), 0);
  assert.equal(sent.filter(item => item.content.forward).length, 1);
  assert.equal(sent.every(item => item.jid === pairedJid), true);
});

test('anti-delete targets the paired account self-chat even when its identity is a LID', async () => {
  const antiDelete = createAntiDelete();
  const sent = [];
  const sock = { user: { id: '230451234996366:7@lid' }, async sendMessage(jid, content) { sent.push({ jid, content }); } };
  const chat = '254700000031@s.whatsapp.net';
  antiDelete.remember(sock, [{ key: { remoteJid: chat, id: 'lid-dest', fromMe: false }, message: { conversation: 'recovered' } }], { autoAntiDelete: true, ownerNumber: '' });
  await antiDelete.handleUpdates(sock, [{ key: { remoteJid: chat, id: 'lid-dest' }, update: { messageStubType: WAMessageStubType.REVOKE } }], { autoAntiDelete: true, ownerNumber: '' }, silentLogger);
  assert.equal(sent.length, 2);
  assert.ok(sent.every(item => item.jid === '230451234996366@lid'));
});

test('anti-delete can be disabled', async () => {
  const antiDelete = createAntiDelete();
  assert.equal(antiDelete.remember({}, [{ key: { remoteJid: 'chat@s.whatsapp.net', id: 'm' }, message: { conversation: 'secret' } }], { autoAntiDelete: false, ownerNumber }), 0);
  let sendCount = 0;
  assert.equal(await antiDelete.handleUpdates({ async sendMessage() { sendCount++; } }, [
    { key: { remoteJid: 'chat@s.whatsapp.net', id: 'm' }, update: { messageStubType: WAMessageStubType.REVOKE } }
  ], { autoAntiDelete: false, ownerNumber }, silentLogger), 0);
  assert.equal(sendCount, 0);
});
