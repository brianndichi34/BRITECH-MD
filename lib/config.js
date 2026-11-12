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
  statusLikeEmoji: process.env.STATUS_LIKE_EMOJI || '❤️',
  autoTyping: String(process.env.AUTO_TYPING || 'false').toLowerCase() === 'true',
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  logLevel: process.env.LOG_LEVEL || 'info'
};
module.exports = config;
