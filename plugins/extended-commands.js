'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { readMedia } = require('./media');

function quotedKey(msg, chat) {
  const content = msg?.message || {};
  const node = Object.values(content).find(value => value?.contextInfo);
  const info = node?.contextInfo;
  if (!info?.stanzaId || !info.quotedMessage) return null;
  return { remoteJid: chat, id: info.stanzaId, participant: info.participant, fromMe: Boolean(info.fromMe) };
}

function savePrefix(prefix) {
  const file = path.resolve(process.env.RUNTIME_SETTINGS_FILE || './runtime-settings.json');
  let current = {};
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  fs.writeFileSync(file, JSON.stringify({ ...current, prefix }, null, 2) + '\n', { mode: 0o600 });
}

function encode(value) { return encodeURIComponent(String(value || '').trim()); }

async function appleSearch(query) {
  const response = await fetch(`https://itunes.apple.com/search?term=${encode(query)}&media=music&limit=5`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Apple Music search failed (${response.status}).`);
  const data = await response.json();
  return (data.results || []).map((item, index) => `${index + 1}. ${item.trackName || 'Unknown'} — ${item.artistName || 'Unknown'}\n${item.trackViewUrl || item.collectionViewUrl || ''}`).join('\n\n');
}

module.exports = {
  name: 'extended-commands',
  category: 'TOOLS',
  commands: {
    pin: 'Pin a replied message in a group (owner only)',
    unpin: 'Unpin a replied message in a group (owner only)',
    prefix: 'Change the command prefix (owner only; use none for prefixless)',
    spotify: 'Open a Spotify search link for a track or artist',
    soundcloud: 'Open a SoundCloud search link for a track or artist',
    apple: 'Search Apple Music tracks',
    ncs: 'Open an NCS search link',
    spotifysearch: 'Search Spotify by link',
    soundcloudsearch: 'Search SoundCloud by link',
    applesearch: 'Search Apple Music tracks',
    ncssearch: 'Search NCS by link',
    imageedit: 'Apply a safe local edit to a replied image',
    deepseek: 'AI alias using the configured BRITECH AI provider',
    wormgpt: 'AI alias using the configured BRITECH AI provider',
    copilot: 'AI alias using the configured BRITECH AI provider'
  },
  async handle(command, ctx) {
    if (['pin', 'unpin'].includes(command)) {
      if (!ctx.isOwner(ctx.sender)) return ctx.reply('🔒 Only the bot owner can pin or unpin messages.');
      if (!ctx.chat?.endsWith('@g.us')) return ctx.reply('This command can only be used in a group.');
      const key = quotedKey(ctx.msg, ctx.chat);
      if (!key) return ctx.reply(`Reply to a message with ${ctx.config.prefix}${command}.`);
      await ctx.sock.sendMessage(ctx.chat, { pin: key, type: command === 'pin' ? 1 : 2, time: 604800 }, { quoted: ctx.msg });
      return ctx.reply(command === 'pin' ? '📌 Message pinned for 7 days.' : '📍 Message unpinned.');
    }

    if (command === 'prefix') {
      if (!ctx.isOwner(ctx.sender)) return ctx.reply('🔒 Only the bot owner can change the prefix.');
      const value = String(ctx.args[0] || '').trim();
      if (!value || value.length > 3 || /\s/.test(value)) return ctx.reply(`Usage: ${ctx.config.prefix || '.'}prefix .   or   ${ctx.config.prefix || '.'}prefix none`);
      const prefix = value.toLowerCase() === 'none' ? '' : value;
      savePrefix(prefix);
      ctx.config.prefix = prefix;
      return ctx.reply(prefix ? `✅ Prefix changed to: ${prefix}` : '✅ Prefixless mode enabled. Send commands without a prefix.');
    }

    if (['deepseek', 'wormgpt', 'copilot'].includes(command)) {
      if (!ctx.isOwner(ctx.sender)) return ctx.reply('🔒 AI aliases are owner-only.');
      return ctx.reply(`Use ${ctx.config.prefix}ai ${ctx.query || 'your question'} — this bot uses the configured OpenAI or Gemini provider. It does not claim to impersonate DeepSeek, WormGPT, or Copilot.`);
    }

    if (['spotify', 'spotifysearch'].includes(command)) {
      if (!ctx.query) return ctx.reply(`Usage: ${ctx.config.prefix}${command} artist or song`);
      return ctx.reply(`🎵 Spotify search:\nhttps://open.spotify.com/search/${encode(ctx.query)}`);
    }
    if (['soundcloud', 'soundcloudsearch'].includes(command)) {
      if (!ctx.query) return ctx.reply(`Usage: ${ctx.config.prefix}${command} artist or song`);
      return ctx.reply(`🎧 SoundCloud search:\nhttps://soundcloud.com/search?q=${encode(ctx.query)}`);
    }
    if (['ncs', 'ncssearch'].includes(command)) {
      if (!ctx.query) return ctx.reply(`Usage: ${ctx.config.prefix}${command} track or artist`);
      return ctx.reply(`🎼 NCS search:\nhttps://www.youtube.com/results?search_query=${encode(`NoCopyrightSounds ${ctx.query}`)}`);
    }
    if (['apple', 'applesearch'].includes(command)) {
      if (!ctx.query) return ctx.reply(`Usage: ${ctx.config.prefix}${command} artist or song`);
      const result = await appleSearch(ctx.query);
      return ctx.reply(result ? `🍎 Apple Music results:\n\n${result}` : 'No Apple Music results found.');
    }
    if (command === 'imageedit') {
      const operation = String(ctx.args[0] || 'grayscale').toLowerCase();
      if (!['grayscale', 'rotate', 'flip'].includes(operation)) return ctx.reply(`Usage: ${ctx.config.prefix}imageedit grayscale|rotate|flip`);
      const { buffer } = await readMedia(ctx.msg, ctx.chat);
      let image = sharp(buffer, { limitInputPixels: 16000000 }).rotate();
      if (operation === 'grayscale') image = image.grayscale();
      if (operation === 'rotate') image = image.rotate(90);
      if (operation === 'flip') image = image.flip();
      const output = await image.jpeg({ quality: 86 }).toBuffer();
      return ctx.sock.sendMessage(ctx.chat, { image: output, mimetype: 'image/jpeg', caption: `🖼️ Applied: ${operation}` }, { quoted: ctx.msg });
    }
  }
};
