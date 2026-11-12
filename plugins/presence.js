const { jidNormalizedUser } = require('@whiskeysockets/baileys');

const afkUsers = new Map();
const lastNotice = new Map();

function userKeys(jid) {
  if (!jid) return [];
  const normalized = jidNormalizedUser(jid);
  return [...new Set([jid, normalized].filter(Boolean))];
}

function contextInfo(message) {
  for (const value of Object.values(message?.message || {})) {
    if (value && typeof value === 'object' && value.contextInfo) return value.contextInfo;
  }
  return {};
}

function findAfk(jid) {
  for (const key of userKeys(jid)) if (afkUsers.has(key)) return afkUsers.get(key);
  return null;
}

module.exports = {
  name: 'presence',
  category: 'PRESENCE',
  commands: {
    afk: 'Set an away status: .afk reason',
    back: 'Clear your away status'
  },
  async handle(command, ctx) {
    const keys = userKeys(ctx.sender);
    if (command === 'afk') {
      const entry = { reason: ctx.query.trim().slice(0, 200), since: Date.now() };
      for (const key of keys) afkUsers.set(key, entry);
      return ctx.reply(entry.reason ? `You are now AFK: ${entry.reason}` : 'You are now AFK.');
    }
    if (command === 'back') {
      for (const key of keys) afkUsers.delete(key);
      return ctx.reply('Your AFK status has been cleared.');
    }
  },
  async observe(ctx) {
    const body = ctx.text.startsWith(ctx.config.prefix) ? ctx.text.slice(ctx.config.prefix.length).trim() : '';
    const command = (body.split(/\s+/, 1)[0] || '').toLowerCase();
    if (command !== 'afk' && command !== 'back') {
      const own = findAfk(ctx.sender);
      if (own) {
        for (const key of userKeys(ctx.sender)) afkUsers.delete(key);
        await ctx.reply('Welcome back. Your AFK status was cleared.');
      }
    }

    const info = contextInfo(ctx.msg);
    for (const mentioned of info.mentionedJid || []) {
      const target = findAfk(mentioned);
      if (!target) continue;
      const keys = userKeys(mentioned);
      const targetKey = keys[1] || keys[0];
      const throttleKey = `${ctx.chat}:${targetKey}`;
      if (Date.now() - (lastNotice.get(throttleKey) || 0) < 60000) continue;
      lastNotice.set(throttleKey, Date.now());
      const duration = Math.max(0, Math.floor((Date.now() - target.since) / 60000));
      const reason = target.reason ? `\nReason: ${target.reason}` : '';
      await ctx.reply(`That person is AFK${duration ? ` (${duration} min)` : ''}.${reason}`);
    }
  }
};
