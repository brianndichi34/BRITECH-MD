require('dotenv').config();

function digits(value = '') { return String(value).replace(/\D/g, ''); }
function booleanSetting(name, fallback) {
  const value = process.env[name];
  return value === undefined ? fallback : String(value).toLowerCase() === 'true';
}
const config = {
  botName: process.env.BOT_NAME || 'BRITECH MD',
  ownerName: process.env.OWNER_NAME || 'BRIAN NDICHI',
  ownerNumber: digits(process.env.OWNER_NUMBER || '254717276195'),
  ownerEmail: process.env.OWNER_EMAIL || 'brianndichi340@gmail.com',
  prefix: process.env.PREFIX || '.',
  timezone: process.env.TIMEZONE || 'Africa/Nairobi',
  sessionDir: process.env.SESSION_DIR || './session/auth',
  autoRead: String(process.env.AUTO_READ || 'false').toLowerCase() === 'true',
  autoViewStatus: booleanSetting('AUTO_VIEW_STATUS', true),
  autoLikeStatus: booleanSetting('AUTO_LIKE_STATUS', true),
  autoAntiDelete: booleanSetting('AUTO_ANTI_DELETE', true),
  autoSetBotProfile: booleanSetting('AUTO_SET_BOT_PROFILE', true),
  statusLikeEmoji: process.env.STATUS_LIKE_EMOJI || '❤️',
  statusLikeEmojis: (process.env.STATUS_LIKE_EMOJIS || process.env.STATUS_LIKE_EMOJI || '❤️,🥰,🌺,💕,💥,🙏,🔥,💯,💘,💖')
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
