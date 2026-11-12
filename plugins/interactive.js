function contextInfo(message) {
  for (const value of Object.values(message?.message || {})) {
    if (value && typeof value === 'object' && value.contextInfo) return value.contextInfo;
  }
  return {};
}

function quotedKey(message, chat) {
  const info = contextInfo(message);
  if (!info.stanzaId) return null;
  return {
    remoteJid: chat,
    id: info.stanzaId,
    participant: info.participant,
    fromMe: Boolean(info.fromMe)
  };
}

module.exports = {
  name: 'whatsapp-interactions',
  category: 'INTERACTIVE',
  commands: {
    poll: 'Create a native WhatsApp poll: .poll Question | Option 1 | Option 2',
    react: 'React to a replied message with one emoji: .react 👍'
  },
  async handle(command, ctx) {
    if (command === 'poll') {
      const parts = ctx.query.split('|').map(part => part.trim()).filter(Boolean);
      if (parts.length < 3) return ctx.reply(`Usage: ${ctx.config.prefix}poll Question | Option 1 | Option 2`);
      const [name, ...values] = parts;
      if (name.length > 255) throw new Error('Poll question must be 255 characters or fewer.');
      if (values.length > 12) throw new Error('A WhatsApp poll can have at most 12 options.');
      if (values.some(value => value.length > 100)) throw new Error('Each poll option must be 100 characters or fewer.');
      const duplicates = new Set(values.map(value => value.toLocaleLowerCase()));
      if (duplicates.size !== values.length) throw new Error('Poll options must be unique.');
      return ctx.sock.sendMessage(ctx.chat, {
        poll: { name, values, selectableCount: 1, toAnnouncementGroup: false }
      }, { quoted: ctx.msg });
    }

    if (command === 'react') {
      const emoji = ctx.query.trim();
      const key = quotedKey(ctx.msg, ctx.chat);
      if (!key) return ctx.reply(`Reply to a message with ${ctx.config.prefix}react 👍`);
      if (!emoji || emoji.length > 16 || /[\r\n]/.test(emoji)) throw new Error('Provide one emoji, for example .react 👍');
      return ctx.sock.sendMessage(ctx.chat, { react: { text: emoji, key } });
    }
  }
};
