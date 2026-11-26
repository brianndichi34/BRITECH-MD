require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

function digits(value = '') { return String(value).replace(/\D/g, ''); }
function booleanSetting(name, fallback) {
  const value = process.env[name];
  return value === undefined ? fallback : String(value).toLowerCase() === 'true';
}
function runtimeSetting(name, fallback) {
  try {
    const file = path.resolve(process.env.RUNTIME_SETTINGS_FILE || './runtime-settings.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data?.[name] ?? fallback;
  } catch { return fallback; }
}
const config = {
  botName: process.env.BOT_NAME || 'BRITECH-NB',
  ownerName: process.env.OWNER_NAME || 'BRIAN NDICHI',
  ownerNumber: digits(process.env.OWNER_NUMBER || '254717276195'),
  ownerEmail: process.env.OWNER_EMAIL || 'brianndichi340@gmail.com',
  prefix: String(runtimeSetting('prefix', process.env.PREFIX || '.')),
  accessMode: ['public', 'private'].includes(runtimeSetting('accessMode', process.env.BOT_MODE || 'private'))
    ? runtimeSetting('accessMode', process.env.BOT_MODE || 'private') : 'private',
  timezone: process.env.TIMEZONE || 'Africa/Nairobi',
  sessionDir: process.env.SESSION_DIR || './session/auth',
  autoRead: String(process.env.AUTO_READ || 'false').toLowerCase() === 'true',
  autoViewStatus: booleanSetting('AUTO_VIEW_STATUS', true),
  autoLikeStatus: booleanSetting('AUTO_LIKE_STATUS', true),
  autoReactCommands: booleanSetting('AUTO_REACT_COMMANDS', true),
  autoAntiDelete: booleanSetting('AUTO_ANTI_DELETE', true),
  autoSetBotProfile: booleanSetting('AUTO_SET_BOT_PROFILE', true),
  autoSessionRecovery: booleanSetting('AUTO_SESSION_RECOVERY', true),
  badMacRecoveryThreshold: Math.max(1, Number.parseInt(process.env.BAD_MAC_RECOVERY_THRESHOLD || '3', 10) || 3),
  statusLikeEmoji: process.env.STATUS_LIKE_EMOJI || '💕',
  statusLikeEmojis: (process.env.STATUS_LIKE_EMOJIS || process.env.STATUS_LIKE_EMOJI || '💕,💞,💖,💯,🥰')
    .split(',').map(emoji => emoji.trim()).filter(Boolean),
  commandReactionEmojis: (process.env.COMMAND_REACTION_EMOJIS || '💕,💞,💖,💯,🥰')
    .split(',').map(emoji => emoji.trim()).filter(Boolean),
  autoTyping: String(process.env.AUTO_TYPING || 'false').toLowerCase() === 'true',
  welcomeMessage: process.env.WELCOME_MESSAGE || 'WELCOME TO BRITECH BOT🔥💯\nFOUNDED BY BRIAN N.🌺',
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  manusApiKey: process.env.MANUS_API_KEY || '',
  logLevel: process.env.LOG_LEVEL || 'info'
};
module.exports = config;
