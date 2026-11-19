'use strict';

const fs = require('node:fs');
const path = require('node:path');

function settingsPath() {
  return path.resolve(process.env.RUNTIME_SETTINGS_FILE || './runtime-settings.json');
}

function saveMode(mode) {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } })();
  fs.writeFileSync(file, JSON.stringify({ ...current, accessMode: mode }, null, 2) + '\n', { mode: 0o600 });
}

module.exports = {
  name: 'access-control',
  category: 'OWNER',
  commands: {
    mode: 'Show or change bot access mode (owner only)',
    private: 'Set the bot to private owner-only mode (owner only)',
    public: 'Allow commands from all users (owner only)'
  },
  async handle(command, ctx) {
    if (!ctx.isOwner(ctx.sender)) return ctx.reply('🔒 Only the bot owner can change or view access mode.');
    const requested = command === 'private' ? 'private' : command === 'public' ? 'public' : String(ctx.args[0] || '').toLowerCase();
    if (!requested) return ctx.reply(`🔐 Current mode: *${ctx.config.accessMode || 'private'}*\nUsage: ${ctx.config.prefix}mode private\nUsage: ${ctx.config.prefix}mode public`);
    if (!['private', 'public'].includes(requested)) return ctx.reply(`Usage: ${ctx.config.prefix}mode private|public`);
    saveMode(requested);
    ctx.config.accessMode = requested;
    return ctx.reply(requested === 'private'
      ? '🔒 Private mode enabled. Only the owner can use bot commands.'
      : '🌍 Public mode enabled. All users may use available commands.');
  }
};
