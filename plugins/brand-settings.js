const fs = require('node:fs/promises');
const path = require('node:path');
const dns = require('node:dns/promises');
const net = require('node:net');
const sharp = require('sharp');
const config = require('../lib/config');
const { ASSET_DIR, CUSTOM_AVATAR_PATH } = require('../lib/brand-assets');

const MAX_PROFILE_BYTES = 5 * 1024 * 1024;
const MENU_PROFILE_PATH = CUSTOM_AVATAR_PATH;
function configuredManusKey() { return String(process.env.MANUS_API_KEY || config.manusApiKey || '').trim(); }

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (family === 6) {
    const ip = address.toLowerCase();
    return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') ||
      ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb') ||
      ip.startsWith('::ffff:127.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:192.168.');
  }
  return true;
}

async function validatePublicHttpsUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Provide a valid public HTTPS image URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw new Error('Profile image URL must be HTTPS and cannot contain credentials.');
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Private or local URLs are not allowed.');
  }
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('Private or local URLs are not allowed.');
  }
  return url;
}

async function readBounded(response, maxBytes) {
  if (!response.body) throw new Error('Image server returned an empty response.');
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('Profile image must be 5 MB or smaller.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Profile image must be 5 MB or smaller.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function fetchProfileImage(rawUrl) {
  const url = await validatePublicHttpsUrl(rawUrl);
  let response;
  try {
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { Accept: 'image/png,image/jpeg,image/webp,image/*;q=0.8' } });
  } catch {
    throw new Error('Could not safely download that image. Use a direct public HTTPS image link.');
  }
  if (!response.ok) throw new Error(`Image URL returned HTTP ${response.status}.`);
  if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
    throw new Error('That URL did not return an image. Use a direct PNG, JPEG, or WebP image link.');
  }
  const raw = await readBounded(response, MAX_PROFILE_BYTES);
  try {
    const jpeg = await sharp(raw, { limitInputPixels: 16000000 }).rotate().resize(640, 640, { fit: 'cover' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
    const metadata = await sharp(jpeg).metadata();
    if (metadata.width !== 640 || metadata.height !== 640) throw new Error('Unexpected profile image dimensions.');
    return jpeg;
  } catch (error) {
    if (error.message.includes('Unexpected')) throw error;
    throw new Error('That image could not be decoded. Try a normal square PNG or JPEG.');
  }
}

async function setMenuProfile(ctx) {
  if (!ctx.isOwner(ctx.sender)) return ctx.reply('Only the bot owner can change its profile image.');
  if (!ctx.query) return ctx.reply(`Usage: ${ctx.config.prefix}setmenuprofile https://example.com/image.jpg`);
  if (typeof ctx.sock.updateProfilePicture !== 'function') throw new Error('This WhatsApp connection does not support profile-picture updates.');
  const image = await fetchProfileImage(ctx.query.trim());
  await fs.mkdir(ASSET_DIR, { recursive: true });
  await fs.writeFile(MENU_PROFILE_PATH, image, { mode: 0o600 });
  const ownJid = ctx.sock.user?.id || `${ctx.config.ownerNumber}@s.whatsapp.net`;
  await ctx.sock.updateProfilePicture(ownJid, image);
  return ctx.reply('✅ BRITECH-MD profile picture updated. New .menu cards will use this image.');
}

async function createManusTask(prompt) {
  const apiKey = configuredManusKey();
  if (!apiKey) throw new Error('Manus AI is not configured. Add MANUS_API_KEY to the bot host environment, then restart.');
  if (!prompt || prompt.trim().length < 2) throw new Error('Usage: .manus your question or task');
  if (prompt.length > 4000) throw new Error('Manus prompts are limited to 4,000 characters.');
  const response = await fetch('https://api.manus.ai/v2/task.create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-manus-api-key': apiKey },
    body: JSON.stringify({
      message: { content: prompt.trim() },
      locale: 'en',
      interactive_mode: false,
      share_visibility: 'private'
    }),
    signal: AbortSignal.timeout(20000)
  });
  let data;
  try { data = await response.json(); } catch { throw new Error(`Manus API returned an unreadable response (HTTP ${response.status}).`); }
  if (!response.ok || data?.ok === false) throw new Error(data?.error?.message || `Manus API request failed (HTTP ${response.status}).`);
  if (!data.task_url) throw new Error('Manus created a task but returned no task link.');
  return { title: data.task_title || 'Manus task', url: data.task_url };
}

async function checkManusApiKey() {
  const apiKey = configuredManusKey();
  if (!apiKey) throw new Error('MANUS_API_KEY is not configured. Add it privately to KataBump environment variables or the host-only .env file, then restart the bot.');
  let response;
  try {
    response = await fetch('https://api.manus.ai/v2/user.me', {
      method: 'GET',
      headers: { 'x-manus-api-key': apiKey },
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    throw new Error('Could not reach the Manus API. Check the host network and try again.');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error(`Manus API returned an unreadable response (HTTP ${response.status}).`); }
  if (!response.ok || data?.ok !== true || !data?.user_id) {
    if (response.status === 401) throw new Error('Manus rejected the API key. Check the MANUS_API_KEY value in the bot host settings and restart.');
    throw new Error(`Manus API key check failed (HTTP ${response.status}). Check the key and account access in Manus settings.`);
  }
  return true;
}

module.exports = {
  name: 'brand-and-manus',
  category: 'BRITECH / AI',
  commands: {
    settings: 'Show BRITECH-MD settings and feature status',
    setmenuprofile: 'Set the bot WhatsApp/menu profile picture from a direct HTTPS image URL (owner only)',
    manus: 'Start a private Manus AI task and receive its task link (owner only; needs MANUS_API_KEY)',
    manuscheck: 'Check that the configured Manus API key is accepted without showing the key (owner only)'
  },
  fetchProfileImage,
  createManusTask,
  checkManusApiKey,
  async handle(command, ctx) {
    if (command === 'settings') {
      const status = value => value ? '✅ ON' : '▫️ OFF';
      const connected = ctx.sock.user?.id || 'not available';
      const dashboard = [
        `╭━━━🌈 *${ctx.config.botName}* 🌈━━━╮`,
        '⚙️ *BOT SETTINGS & STATUS*',
        '━━━━━━━━━━━━━━━━━━━━',
        '🟦 *ACCOUNT*',
        `▫️ Owner: ${ctx.config.ownerName}`,
        `▫️ Prefix: ${ctx.config.prefix}   🌍 ${ctx.config.timezone}`,
        `▫️ Linked: ${connected}`,
        '━━━━━━━━━━━━━━━━━━━━',
        '🛡️ *PROTECTION*',
        `▫️ Anti-delete → ${status(ctx.config.autoAntiDelete)}`,
        '▫️ Deleted content → linked account DM',
        '━━━━━━━━━━━━━━━━━━━━',
        '⚡ *AUTOMATION*',
        `▫️ Auto-view status → ${status(ctx.config.autoViewStatus)}`,
        `▫️ Auto-like status → ${status(ctx.config.autoLikeStatus)}`,
        `▫️ Command reactions → ${status(ctx.config.autoReactCommands)}`,
        `▫️ Auto-read chats → ${status(ctx.config.autoRead)}`,
        '━━━━━━━━━━━━━━━━━━━━',
        '🎨 *BRAND & AI*',
        `▫️ Menu profile → ${status(ctx.menuProfileAvailable)}`,
        `▫️ Manus AI → ${status(Boolean(ctx.config.manusApiKey || process.env.MANUS_API_KEY))}`,
        `▫️ OpenAI-compatible AI → ${status(Boolean(ctx.config.openaiKey))}`,
        '╰━━━━━━━━━━━━━━━━━━━╯',
        `💡 ${ctx.config.prefix}menu  ·  🩺 ${ctx.config.prefix}doctor`
      ].join('\n');
      return ctx.reply(dashboard);
    }
    if (command === 'setmenuprofile') return setMenuProfile(ctx);
    if (command === 'manuscheck') {
      if (!ctx.isOwner(ctx.sender)) return ctx.reply('Only the bot owner can check the Manus API configuration.');
      await checkManusApiKey();
      return ctx.reply('✅ Manus API key is valid and the account is reachable. The key itself was not displayed.');
    }
    if (command === 'manus') {
      if (!ctx.isOwner(ctx.sender)) return ctx.reply('Only the bot owner can run Manus AI tasks.');
      const task = await createManusTask(ctx.query);
      return ctx.reply(`🧠 Manus AI task started privately.\n${task.title}\n${task.url}`);
    }
  }
};
