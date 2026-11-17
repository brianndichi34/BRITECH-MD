const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const config = require('../lib/config');
const plugins = require('../lib/plugin-loader');
const media = require('../plugins/media');
const interactive = require('../plugins/interactive');
const groupTools = require('../plugins/group-tools');
const presence = require('../plugins/presence');
const brandSettings = require('../plugins/brand-settings');
const health = require('../plugins/health');
const maintenance = require('../plugins/maintenance');
const { getText, handleMessage, askAI, commands: allCommands, selectCommandEmoji } = require('../lib/handler');
const { dispatchUpsert } = require('../lib/message-dispatcher');
const root = path.join(__dirname, '..');

test('plugin registry loads unique command names and describes all available modules', () => {
  assert.deepEqual(plugins.plugins.map(plugin => plugin.name), [
    'brand-and-manus', 'group-tools', 'health-and-safe-repair', 'whatsapp-interactions', 'maintenance-and-diagnostics', 'local-media', 'presence'
  ]);
  for (const command of ['sticker', 'toimg', 'qr', 'poll', 'react', 'setname', 'setdesc', 'mute', 'unmute', 'revoke', 'afk', 'back', 'settings', 'setmenuprofile', 'manus', 'manuscheck', 'doctor', 'diagnose', 'autofix', 'uptime', 'runtime', 'jid', 'update']) {
    assert.equal(typeof plugins.descriptions[command], 'string', `${command} should be registered`);
  }
  assert.equal(plugins.get('STICKER').plugin, media);
  assert.ok(plugins.categories()['GROUP TOOLS'].includes('revoke'));
});

test('plugin loader rejects malformed or duplicate command modules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'britech-plugins-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.js'), "module.exports={name:'a',commands:{ping:'one'},handle:async()=>{}};");
    fs.writeFileSync(path.join(dir, 'b.js'), "module.exports={name:'b',commands:{ping:'two'},handle:async()=>{}};");
    assert.throws(() => plugins.loadPlugins(dir), /Duplicate command plugin: ping/);
  } finally {
    for (const filename of ['a.js', 'b.js']) {
      const full = path.join(dir, filename);
      try { delete require.cache[require.resolve(full)]; } catch {}
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('static-image sticker conversion and sticker-to-PNG conversion work locally', async () => {
  const source = await sharp({ create: { width: 160, height: 100, channels: 4, background: { r: 40, g: 130, b: 90, alpha: 1 } } }).png().toBuffer();
  const sticker = await media.createStickerBuffer(source);
  const stickerInfo = await sharp(sticker).metadata();
  assert.equal(stickerInfo.format, 'webp');
  assert.ok(stickerInfo.width <= 512 && stickerInfo.height <= 512);
  assert.ok(sticker.length < 1024 * 1024);
  const image = await media.stickerToPng(sticker);
  assert.equal((await sharp(image).metadata()).format, 'png');
});

test('sticker and toimg commands send the converted media through their actual handlers', async () => {
  const source = await sharp({ create: { width: 80, height: 60, channels: 4, background: { r: 25, g: 100, b: 180, alpha: 1 } } }).png().toBuffer();
  const sent = [];
  const common = {
    chat: '254700000001@s.whatsapp.net', config: { prefix: '.' },
    sock: { async sendMessage(chat, payload, options) { sent.push({ chat, payload, options }); } },
    async reply(text) { throw new Error(`unexpected reply: ${text}`); }
  };
  await media.handle('sticker', {
    ...common, query: '',
    msg: { key: { id: 'image-command' }, message: { imageMessage: { fileLength: String(source.length) } } },
    async downloadMediaMessage() { return source; }
  });
  assert.equal((await sharp(sent[0].payload.sticker).metadata()).format, 'webp');

  const sticker = sent[0].payload.sticker;
  await media.handle('toimg', {
    ...common, query: '',
    msg: { key: { id: 'toimg-command' }, message: { extendedTextMessage: { contextInfo: {
      stanzaId: 'quoted-sticker', participant: '254700000002@s.whatsapp.net',
      quotedMessage: { stickerMessage: { fileLength: String(sticker.length) } }
    } } } },
    async downloadMediaMessage() { return sticker; }
  });
  assert.equal(sent[1].payload.mimetype, 'image/png');
  assert.equal((await sharp(sent[1].payload.image).metadata()).format, 'png');
});

test('QR plugin returns a real PNG and enforces bounded input size', async () => {
  const qr = await media.createQrImage('https://github.com/brianndichi34/BRITECH-MD');
  assert.equal((await sharp(qr).metadata()).format, 'png');
  assert.ok(qr.length > 100);
  await assert.rejects(media.createQrImage('x'.repeat(1501)), /1,500 bytes/);
  let payload;
  await media.handle('qr', {
    query: 'BRITECH MD', chat: '254700000001@s.whatsapp.net', msg: { key: { id: 'qr' } },
    config: { prefix: '.' }, sock: { async sendMessage(_chat, value) { payload = value; } }, async reply() {}
  });
  assert.equal((await sharp(payload.image).metadata()).format, 'png');
});

test('native poll plugin parses options and sends Baileys poll content', async () => {
  let sent;
  const ctx = {
    query: 'Favorite color? | Red | Blue | Green',
    config: { prefix: '.' },
    chat: '12345@g.us', msg: { key: { id: 'msg-1' } },
    sock: { async sendMessage(...args) { sent = args; } },
    async reply(text) { throw new Error(`unexpected reply: ${text}`); }
  };
  await interactive.handle('poll', ctx);
  assert.deepEqual(sent[1].poll, { name: 'Favorite color?', values: ['Red', 'Blue', 'Green'], selectableCount: 1, toAnnouncementGroup: false });
  await assert.rejects(interactive.handle('poll', { ...ctx, query: 'Question | Duplicate | duplicate' }), /must be unique/);
});

test('reaction plugin requires a reply and reacts to its exact quoted message', async () => {
  let sent;
  const msg = { key: { remoteJid: '12345@g.us' }, message: { extendedTextMessage: { contextInfo: { stanzaId: 'quoted-1', participant: '254712345678@s.whatsapp.net' } } } };
  await interactive.handle('react', {
    query: '👍', msg, chat: '12345@g.us', config: { prefix: '.' },
    sock: { async sendMessage(...args) { sent = args; } }, async reply() { throw new Error('should not reply'); }
  });
  assert.deepEqual(sent[1].react, { text: '👍', key: { remoteJid: '12345@g.us', id: 'quoted-1', participant: '254712345678@s.whatsapp.net', fromMe: false } });
  let missingReply = '';
  await interactive.handle('react', { query: '👍', msg: { key: {} }, chat: '12345@g.us', config: { prefix: '.' }, sock: { sendMessage() {} }, async reply(text) { missingReply = text; } });
  assert.match(missingReply, /reply/i);
});

test('group tools enforce admin permissions and call supported Baileys group methods', async () => {
  const calls = [];
  const ctx = {
    chat: '12345@g.us', sender: '254712345678@s.whatsapp.net', query: 'BRITECH updates',
    config: { prefix: '.' }, isOwner: () => false,
    async groupContext() { return { meta: { subject: 'Old name' }, isAdmin: true, botAdmin: true }; },
    sock: {
      async groupUpdateSubject(...args) { calls.push(['name', ...args]); },
      async groupUpdateDescription(...args) { calls.push(['desc', ...args]); },
      async groupSettingUpdate(...args) { calls.push(['settings', ...args]); },
      async groupRevokeInvite(...args) { calls.push(['revoke', ...args]); return 'newInviteCode'; }
    }, async reply(text) { calls.push(['reply', text]); }
  };
  await groupTools.handle('setname', ctx);
  await groupTools.handle('setdesc', ctx);
  await groupTools.handle('mute', ctx);
  await groupTools.handle('unmute', ctx);
  await groupTools.handle('revoke', ctx);
  assert.deepEqual(calls.filter(call => call[0] !== 'reply').map(call => call[0]), ['name', 'desc', 'settings', 'settings', 'revoke']);
  let denied = '';
  await groupTools.handle('mute', { ...ctx, async groupContext() { return { isAdmin: false, botAdmin: true }; }, async reply(text) { denied = text; } });
  assert.match(denied, /group admin/i);
});

test('AFK plugin sets, clears, and mentions temporary away status', async () => {
  const sender = 'britech-test-user-82911@s.whatsapp.net';
  const replies = [];
  const base = { sender, config: { prefix: '.' }, async reply(text) { replies.push(text); } };
  await presence.handle('afk', { ...base, query: 'working' });
  await presence.observe({ ...base, text: 'hello', msg: { message: {} }, chat: 'group-afk-1@g.us' });
  assert.match(replies.at(-1), /Welcome back/);
  await presence.handle('afk', { ...base, query: 'working' });
  await presence.observe({ ...base, sender: 'another-user@s.whatsapp.net', text: 'hey', chat: 'group-afk-1@g.us', msg: { message: { extendedTextMessage: { contextInfo: { mentionedJid: [sender] } } } } });
  assert.match(replies.at(-1), /AFK/);
  await presence.handle('back', base);
});

test('handler exposes plugin commands in menu/help while preserving existing deployment settings', async () => {
  const sent = [];
  const sock = { async sendMessage(chat, payload) { sent.push({ chat, payload }); } };
  await handleMessage(sock, { key: { remoteJid: '254700000001@s.whatsapp.net', fromMe: false }, message: { conversation: '.menu' }, messageTimestamp: Math.floor(Date.now() / 1000) });
  assert.ok(sent[0].payload.react, 'menu should be acknowledged with a reaction');
  assert.equal(sent[1].payload.image.length > 100, true, 'menu should use the generated branded avatar');
  assert.match(sent[1].payload.caption, /BRITECH MD/);
  assert.match(sent[2].payload.text, /\.sticker/);
  assert.match(sent[2].payload.text, /\.poll/);
  for (const command of Object.keys(allCommands)) assert.ok(sent[2].payload.text.includes(`.${command}`), `menu must list .${command}`);
  await handleMessage(sock, { key: { remoteJid: '254700000002@s.whatsapp.net', fromMe: false }, message: { conversation: '.help revoke' } });
  assert.match(sent[4].payload.text, /Renew the group invite link/);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.start, 'node index.js');
  assert.ok(packageJson.dependencies.sharp && packageJson.dependencies.qrcode);
  assert.match(fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8'), /CMD \["npm", "start"\]/);
  const template = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(template, /^OWNER_NAME=BRIAN NDICHI$/m);
  assert.match(template, /^OWNER_NUMBER=254717276195$/m);
  assert.match(template, /^SESSION_ID=$/m);
  assert.match(template, /^AUTO_VIEW_STATUS=true$/m);
  assert.match(template, /^AUTO_LIKE_STATUS=true$/m);
  assert.match(template, /^AUTO_ANTI_DELETE=true$/m);
  assert.match(template, /^AUTO_SET_BOT_PROFILE=true$/m);
  assert.match(template, /^AUTO_REACT_COMMANDS=true$/m);
  assert.match(template, /^STATUS_LIKE_EMOJI=💕$/m);
  assert.match(template, /^STATUS_LIKE_EMOJIS=💕,💞,💖,💯,🥰$/m);
  assert.match(template, /^COMMAND_REACTION_EMOJIS=💕,💞,💖,💯,🥰$/m);
  assert.match(template, /^GEMINI_API_KEY=$/m);
  assert.match(template, /^GEMINI_MODEL=gemini-3\.6-flash$/m);
  assert.match(template, /^MANUS_API_KEY=$/m);
});

test('handler processes prefixed self-chat commands but ignores ordinary outgoing messages', async () => {
  const sent = [];
  const sock = { async sendMessage(chat, payload) { sent.push({ chat, payload }); } };
  const chat = '230451234996366@lid';
  const msg = text => ({ key: { remoteJid: chat, fromMe: true }, message: { conversation: text } });

  await handleMessage(sock, msg('.menu'));
  await handleMessage(sock, msg('.ping'));
  await handleMessage(sock, msg('ordinary outgoing message'));

  assert.equal(sent.length, 5);
  assert.ok(sent[0].payload.react);
  assert.match(sent[1].payload.caption, /BRITECH MD/);
  assert.match(sent[2].payload.text, /BRITECH MD/);
  assert.ok(sent[3].payload.react);
  assert.match(sent[4].payload.text, /Pong!/);
  assert.ok(sent.every(item => item.chat === chat));
});

test('command acknowledgement emoji selection uses the configured random choices', () => {
  const choices = ['💕', '💞', '💖', '💯', '🥰'];
  let next = 0;
  const represented = new Set(choices.map(() => selectCommandEmoji({ commandReactionEmojis: choices }, max => next++ % max)));
  assert.deepEqual(represented, new Set(choices));
  assert.equal(selectCommandEmoji({ commandReactionEmojis: [] }, () => 0), '💕');
});

test('dispatcher replies to .menu sent from the linked account as an appended ephemeral message', async () => {
  const sent = [];
  const sock = { async sendMessage(chat, payload) { sent.push({ chat, payload }); } };
  const chat = '230451234996367@lid';
  await dispatchUpsert(sock, [{
    key: { remoteJid: chat, fromMe: true },
    message: { ephemeralMessage: { message: { conversation: '.menu' } } },
    messageTimestamp: Math.floor(Date.now() / 1000)
  }], 'append');
  assert.equal(sent.length, 3);
  assert.ok(sent[0].payload.react);
  assert.match(sent[1].payload.caption, /BRITECH MD/);
  assert.match(sent[2].payload.text, /GENERAL/);
});

test('menu text still replies when avatar media sending fails', async () => {
  const sent = [];
  const sock = { async sendMessage(chat, payload) {
    if (payload.image) throw new Error('test avatar transport failure');
    sent.push({ chat, payload });
  } };
  const message = { key: { remoteJid: '254700000004@s.whatsapp.net', fromMe: false }, message: { ephemeralMessage: { message: { conversation: '.menu' } } } };
  await handleMessage(sock, message);
  assert.equal(sent.length, 2);
  assert.ok(sent[0].payload.react);
  assert.match(sent[1].payload.text, /BRITECH MD/);
});


test('settings dashboard displays live protection, status, profile, and AI state', async () => {
  let text = '';
  await brandSettings.handle('settings', {
    config: { botName: 'BRITECH MD', ownerName: 'Brian', prefix: '.', timezone: 'Africa/Nairobi', autoAntiDelete: true, autoViewStatus: true, autoLikeStatus: true, autoRead: false, openaiKey: '', manusApiKey: '' },
    sock: { user: { id: '254717276195@s.whatsapp.net' } }, menuProfileAvailable: true,
    async reply(value) { text = value; }
  });
  assert.match(text, /BOT SETTINGS & STATUS/);
  assert.match(text, /Anti-delete → ✅ ON/);
  assert.match(text, /Deleted content → linked account DM/);
  assert.match(text, /Menu profile → ✅ ON/);
});

test('profile URL validation blocks insecure and local endpoints', async () => {
  await assert.rejects(brandSettings.fetchProfileImage('http://example.com/pic.jpg'), /HTTPS/);
  await assert.rejects(brandSettings.fetchProfileImage('https://127.0.0.1/pic.jpg'), /Private or local/);
  await assert.rejects(brandSettings.fetchProfileImage('https://localhost/pic.jpg'), /Private or local/);
});

test('Manus API task creation uses private v2 task.create and returns its task link', async () => {
  const priorKey = process.env.MANUS_API_KEY;
  const priorFetch = global.fetch;
  process.env.MANUS_API_KEY = 'test-only-key';
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, async json() { return { ok: true, task_title: 'Test task', task_url: 'https://manus.im/app/test-task' }; } };
  };
  try {
    const result = await brandSettings.createManusTask('Summarize my bot settings');
    assert.equal(result.url, 'https://manus.im/app/test-task');
    assert.equal(request.url, 'https://api.manus.ai/v2/task.create');
    assert.equal(request.options.headers['x-manus-api-key'], 'test-only-key');
    assert.equal(JSON.parse(request.options.body).share_visibility, 'private');
  } finally {
    global.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.MANUS_API_KEY; else process.env.MANUS_API_KEY = priorKey;
  }
});

test('Manus API key check validates auth privately and reports invalid credentials without exposing them', async () => {
  const priorKey = process.env.MANUS_API_KEY;
  const priorFetch = global.fetch;
  process.env.MANUS_API_KEY = '  test-only-key  ';
  let request;
  try {
    global.fetch = async (url, options) => {
      request = { url, options };
      return { ok: true, async json() { return { ok: true, user_id: 'user-test-id' }; } };
    };
    assert.equal(await brandSettings.checkManusApiKey(), true);
    assert.equal(request.url, 'https://api.manus.ai/v2/user.me');
    assert.equal(request.options.headers['x-manus-api-key'], 'test-only-key');

    global.fetch = async () => ({ ok: false, status: 401, async json() { return { ok: false }; } });
    await assert.rejects(brandSettings.checkManusApiKey(), error => {
      assert.match(error.message, /rejected the API key/);
      assert.equal(error.message.includes('test-only-key'), false);
      return true;
    });
  } finally {
    global.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.MANUS_API_KEY; else process.env.MANUS_API_KEY = priorKey;
  }
});

test('AI uses Gemini Flash when OpenAI is unset and reads generated text', async () => {
  const oldOpenAI = config.openaiKey;
  const oldGemini = config.geminiApiKey;
  const oldModel = config.geminiModel;
  const oldFetch = global.fetch;
  let request;
  try {
    config.openaiKey = '';
    config.geminiApiKey = 'test-gemini-key';
    config.geminiModel = 'gemini-3.6-flash';
    global.fetch = async (url, options) => {
      request = { url, options };
      return { ok: true, async json() { return { candidates: [{ content: { parts: [{ text: 'Hello from Gemini.' }] } }] }; } };
    };
    assert.equal(await askAI('Say hello'), 'Hello from Gemini.');
    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
    assert.equal(request.options.headers['x-goog-api-key'], 'test-gemini-key');
    assert.equal(JSON.parse(request.options.body).contents[0].parts[0].text, 'Say hello');
  } finally {
    global.fetch = oldFetch;
    config.openaiKey = oldOpenAI;
    config.geminiApiKey = oldGemini;
    config.geminiModel = oldModel;
  }
});

test('AI keeps OpenAI preferred when both provider keys are configured', async () => {
  const oldOpenAI = config.openaiKey;
  const oldGemini = config.geminiApiKey;
  const oldFetch = global.fetch;
  let requestedUrl;
  try {
    config.openaiKey = 'test-openai-key';
    config.geminiApiKey = 'test-gemini-key';
    global.fetch = async url => {
      requestedUrl = url;
      return { ok: true, async json() { return { choices: [{ message: { content: 'Hello from OpenAI.' } }] }; } };
    };
    assert.equal(await askAI('Say hello'), 'Hello from OpenAI.');
    assert.equal(requestedUrl, 'https://api.openai.com/v1/chat/completions');
  } finally {
    global.fetch = oldFetch;
    config.openaiKey = oldOpenAI;
    config.geminiApiKey = oldGemini;
  }
});

test('AI gives setup guidance without calling a provider when no keys are configured', async () => {
  const oldOpenAI = config.openaiKey;
  const oldGemini = config.geminiApiKey;
  const oldFetch = global.fetch;
  let called = false;
  try {
    config.openaiKey = '';
    config.geminiApiKey = '';
    global.fetch = async () => { called = true; throw new Error('should not call provider'); };
    await assert.rejects(askAI('test'), /GEMINI_API_KEY.*OPENAI_API_KEY/);
    assert.equal(called, false);
  } finally {
    global.fetch = oldFetch;
    config.openaiKey = oldOpenAI;
    config.geminiApiKey = oldGemini;
  }
});


test('Bot Doctor sends real WhatsApp quick-reply buttons with supported command IDs', async () => {
  let call;
  const sock = { user: { id: '254717276195@s.whatsapp.net' }, async relayMessage(...args) { call = args; } };
  assert.equal(await health.sendDoctorPanel(sock, '254700000001@s.whatsapp.net', 'Health summary'), true);
  assert.equal(call[0], '254700000001@s.whatsapp.net');
  const encoded = require('@whiskeysockets/baileys').proto.Message.encode(call[1]).finish();
  assert.ok(encoded.length > 0, 'interactive message must serialize using the Baileys proto');
  const roundTrip = require('@whiskeysockets/baileys').proto.Message.decode(encoded);
  const buttons = roundTrip.viewOnceMessage.message.interactiveMessage.nativeFlowMessage.buttons;
  assert.equal(JSON.parse(buttons[0].buttonParamsJson).id, '.diagnose');
  assert.equal(JSON.parse(buttons[1].buttonParamsJson).id, '.autofix');
});

test('interactive quick replies are parsed as commands by the message handler', () => {
  assert.equal(getText({ message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: JSON.stringify({ id: '.diagnose' }) } } } }), '.diagnose');
  assert.equal(getText({ message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{broken' } } } }), '');
});

test('safe auto-fix creates missing folders and env starter but never overwrites existing secrets or credentials', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'britech-doctor-'));
  const sessionDir = path.join(dir, 'session', 'auth');
  try {
    fs.writeFileSync(path.join(dir, '.env.example'), 'SESSION_ID=\nMANUS_API_KEY=\n');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'creds.json'), '{"registered":true,"me":{"id":"keep"}}');
    fs.writeFileSync(path.join(dir, '.env'), 'SESSION_ID=private-value\n');
    const before = fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8');
    const actions = await health.autoFixSafe({ root: dir, sessionDir });
    assert.equal(actions.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'SESSION_ID=private-value\n');
    assert.equal(fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8'), before);

    fs.rmSync(path.join(dir, '.env'));
    const secondActions = await health.autoFixSafe({ root: dir, sessionDir: path.join(dir, 'new-auth') });
    assert.equal(secondActions.length, 2);
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'SESSION_ID=\nMANUS_API_KEY=\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('maintenance commands provide diagnostics and restrict package upgrades to the owner', async () => {
  const replies = [];
  const context = { chat: 'group@g.us', sender: 'user@s.whatsapp.net', args: [], config: { prefix: '.' }, async reply(text) { replies.push(text); }, isOwner: () => false };
  await maintenance.handle('uptime', context);
  await maintenance.handle('runtime', context);
  await maintenance.handle('jid', context);
  await maintenance.handle('update', context);
  assert.match(replies[0], /process uptime/);
  assert.match(replies[1], new RegExp(process.version.replaceAll('.', '\\.')));
  assert.match(replies[2], /group@g\.us/);
  assert.match(replies[3], /Only the bot owner/);
});

test('dependency update check parses npm outdated JSON without installing packages', async () => {
  const result = await maintenance.outdatedDependencies(async args => {
    assert.deepEqual(args, ['outdated', '--json', '--no-fund', '--no-audit']);
    return { stdout: JSON.stringify({ baileys: { current: '6.7.23', wanted: '6.7.24', latest: '7.0.0' } }) };
  });
  assert.deepEqual(result, [{ name: 'baileys', current: '6.7.23', wanted: '6.7.24', latest: '7.0.0' }]);
  assert.equal(maintenance.formatUptime(90061), '1d 1h 1m 1s');
});
