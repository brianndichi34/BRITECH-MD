const config = require('./config');
const { evaluate } = require('mathjs');
const pluginRegistry = require('./plugin-loader');
const fs = require('node:fs');
const path = require('node:path');

const startedAt = Date.now();
const cooldowns = new Map();
const commands = {
  menu: 'Show the command menu', help: 'Show available commands', ping: 'Check response speed',
  alive: 'Check whether the bot is online', owner: 'Show owner contact', info: 'Show bot information',
  repo: 'Show project repository', time: 'Show current time', date: 'Show current date',
  calc: 'Calculate a mathematical expression', quote: 'Show a motivational quote', echo: 'Repeat text',
  groupinfo: 'Show group details', admins: 'List group administrators', tagall: 'Mention group members',
  hidetag: 'Send a message without visible mentions', link: 'Get group invite link',
  close: 'Restrict group messages to admins', open: 'Allow all members to message',
  kick: 'Remove a member (admin only)', promote: 'Promote a member (admin only)',
  demote: 'Demote a member (admin only)', ai: 'Ask AI (requires OPENAI_API_KEY)'
};
Object.assign(commands, pluginRegistry.descriptions);
const quotes = [
  'Great things are done by a series of small things brought together. — Vincent van Gogh',
  'It always seems impossible until it is done. — Nelson Mandela',
  'Success is the sum of small efforts, repeated day in and day out. — Robert Collier',
  'The secret of getting ahead is getting started. — Mark Twain'
];

function jidNumber(jid = '') { return jid.split('@')[0].split(':')[0]; }
function isOwner(sender) { return jidNumber(sender) === config.ownerNumber; }
function isGroup(jid = '') { return jid.endsWith('@g.us'); }
function uptime() {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h ${Math.floor(s % 3600 / 60)}m ${s % 60}s`;
}
function getText(message) {
  const m = message.message || {};
  let interactiveReply = '';
  const paramsJson = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (paramsJson) {
    try { interactiveReply = JSON.parse(paramsJson).id || ''; } catch {}
  }
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption ||
    m.videoMessage?.caption || m.documentMessage?.caption || m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId || interactiveReply || '';
}
function targetFromMessage(message, args) {
  const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentioned[0]) return mentioned[0];
  const quoted = message.message?.extendedTextMessage?.contextInfo?.participant;
  if (quoted) return quoted;
  const number = String(args[0] || '').replace(/\D/g, '');
  return number.length >= 7 ? `${number}@s.whatsapp.net` : null;
}
async function groupContext(sock, chat, sender) {
  if (!isGroup(chat)) throw new Error('This command can only be used in a group.');
  const meta = await sock.groupMetadata(chat);
  const participants = meta.participants || [];
  const me = participants.find(p => p.id === sock.user.id || jidNumber(p.id) === jidNumber(sock.user.id));
  const user = participants.find(p => p.id === sender || jidNumber(p.id) === jidNumber(sender));
  return { meta, participants, isAdmin: !!(user?.admin || user?.isAdmin), botAdmin: !!(me?.admin || me?.isAdmin) };
}
async function askAI(prompt) {
  if (!config.openaiKey) throw new Error('AI is disabled. Add OPENAI_API_KEY to your environment variables.');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.openaiModel, messages: [{ role: 'user', content: prompt }], max_tokens: 500 })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `AI request failed (${response.status})`);
  return data.choices?.[0]?.message?.content || 'No response received.';
}

async function handleMessage(sock, msg) {
  if (!msg.message) return;
  const chat = msg.key.remoteJid;
  if (!chat || chat === 'status@broadcast') return;
  const sender = msg.key.participant || chat;
  const text = getText(msg).trim();
  if (msg.key.fromMe && !text.startsWith(config.prefix)) return;
  const reply = async content => sock.sendMessage(chat, { text: String(content) }, { quoted: msg });
  if (config.autoRead && !msg.key.fromMe) await sock.readMessages([msg.key]).catch(() => {});
  if (!msg.key.fromMe) Promise.resolve().then(() => pluginRegistry.observe({ sock, msg, chat, sender, text, config, reply }))
    .catch(error => console.warn('[PLUGIN:observe]', error?.message || error));
  if (!text.startsWith(config.prefix)) return;

  const body = text.slice(config.prefix.length).trim();
  const [rawCommand, ...args] = body.split(/\s+/);
  const command = (rawCommand || '').toLowerCase();
  const query = args.join(' ');
  if (!command) return;

  const cooldownKey = `${sender}:${command}`;
  const last = cooldowns.get(cooldownKey) || 0;
  if (Date.now() - last < 350) return;
  cooldowns.set(cooldownKey, Date.now());

  try {
    const handledByPlugin = await pluginRegistry.dispatch(command, {
      sock, msg, chat, sender, text, args, query, config, reply,
      menuProfileAvailable: fs.existsSync(path.join(__dirname, '..', 'assets', 'menu-profile.jpg')) || fs.existsSync(path.join(__dirname, '..', 'assets', 'britech-md-avatar.png')),
      isOwner: user => Boolean(msg.key.fromMe) || isOwner(user),
      isGroup,
      jidNumber,
      groupContext: (targetChat, targetSender) => groupContext(sock, targetChat, targetSender)
    });
    if (handledByPlugin) return;
    switch (command) {
      case 'menu': case 'help': {
        if (command === 'help' && query) {
          const description = commands[query.toLowerCase()];
          return reply(description ? `${config.prefix}${query.toLowerCase()} — ${description}` : `Unknown command: ${query}`);
        }
        const sections = {
          GENERAL: ['menu','help','ping','alive','owner','info','repo'],
          UTILITY: ['time','date','calc','quote','echo','ai'],
          GROUP: ['groupinfo','admins','tagall','hidetag','link','close','open','kick','promote','demote']
        };
        Object.assign(sections, pluginRegistry.categories());
        const sectionIcon = heading => /general/i.test(heading) ? '💠' : /utility/i.test(heading) ? '🧰' : /group/i.test(heading) ? '👥' : /media/i.test(heading) ? '🎨' : /health/i.test(heading) ? '🩺' : /presence/i.test(heading) ? '🌙' : /interactive/i.test(heading) ? '💬' : /ai|brand/i.test(heading) ? '✨' : '🔹';
        let out = `╭━━━✨ *${config.botName}* ✨━━━╮\n👑 *Owner:* ${config.ownerName}\n⚙️ *Prefix:* ${config.prefix}   ⏱️ *Uptime:* ${uptime()}\n╰━━━━━━━━━━━━━━━━━━━━━━╯`;
        for (const [heading, names] of Object.entries(sections)) out += `\n\n${sectionIcon(heading)} *${heading}*\n${names.map(n => `▫️ *${config.prefix}${n}*  ${commands[n]}`).join('\n')}`;
        out += `\n\n━━━━━━━━━━━━━━━━━━━━\n📌 *Tip:* ${config.prefix}help <command> for details.\n🤝 Please use WhatsApp respectfully.`;
        const avatarPath = path.join(__dirname, '..', 'assets', 'menu-profile.jpg');
        const defaultAvatarPath = path.join(__dirname, '..', 'assets', 'britech-md-avatar.png');
        const profilePath = fs.existsSync(avatarPath) ? avatarPath : defaultAvatarPath;
        if (fs.existsSync(profilePath)) {
          const avatar = fs.readFileSync(profilePath);
          await sock.sendMessage(chat, { image: avatar, caption: `🌈 *${config.botName}*\n⚡ Fast · 🧠 Helpful · 🛡️ Safer\nType ${config.prefix}settings for live status.` }, { quoted: msg });
        }
        return reply(out);
      }
      case 'ping': return reply(`Pong! 🏓\n${Date.now() - (Number(msg.messageTimestamp) * 1000 || Date.now())} ms message age`);
      case 'alive': return reply(`✅ ${config.botName} is online.\nUptime: ${uptime()}\nMode: Multi-device`);
      case 'owner': return reply(`Owner: ${config.ownerName}\nEmail: ${config.ownerEmail}\nWhatsApp: +${config.ownerNumber}`);
      case 'info': return reply(`🤖 ${config.botName}\nVersion: 1.0.0\nLibrary: Baileys\nOwner: ${config.ownerName}\nUptime: ${uptime()}`);
      case 'repo': return reply('https://github.com/brianndichi34/BRITECH-MD');
      case 'time': return reply(new Intl.DateTimeFormat('en-KE', { timeZone: config.timezone, dateStyle: 'full', timeStyle: 'medium' }).format(new Date()));
      case 'date': return reply(new Intl.DateTimeFormat('en-KE', { timeZone: config.timezone, dateStyle: 'full' }).format(new Date()));
      case 'calc': {
        if (!query) return reply(`Usage: ${config.prefix}calc 25*(4+2)`);
        const result = evaluate(query);
        if (typeof result !== 'number' || !Number.isFinite(result)) return reply('Please enter a valid numeric expression.');
        return reply(`🧮 ${query} = ${result}`);
      }
      case 'quote': return reply(`💡 ${quotes[Math.floor(Math.random() * quotes.length)]}`);
      case 'echo': return reply(query || `Usage: ${config.prefix}echo your message`);
      case 'ai': return reply(await askAI(query || 'Say hello and introduce yourself briefly.'));
      case 'groupinfo': {
        const { meta, participants } = await groupContext(sock, chat, sender);
        return reply(`📌 ${meta.subject}\nMembers: ${participants.length}\nOwner: ${meta.owner ? jidNumber(meta.owner) : 'Unknown'}\nDescription: ${meta.desc || 'None'}`);
      }
      case 'admins': {
        const { meta, participants } = await groupContext(sock, chat, sender);
        const admins = participants.filter(p => p.admin || p.isAdmin);
        return sock.sendMessage(chat, { text: `👑 Admins in ${meta.subject}:\n${admins.map(p => `• @${jidNumber(p.id)}`).join('\n')}`, mentions: admins.map(p => p.id) }, { quoted: msg });
      }
      case 'tagall': case 'hidetag': {
        if (!isOwner(sender)) {
          const ctx = await groupContext(sock, chat, sender);
          if (!ctx.isAdmin) return reply('Only group admins or the bot owner can use this command.');
        }
        const { participants, botAdmin } = await groupContext(sock, chat, sender);
        if (!botAdmin) return reply('Please make BRITECH MD a group admin first.');
        const mentions = participants.map(p => p.id);
        const content = query || (command === 'tagall' ? 'Attention everyone!' : '');
        if (command === 'hidetag') return sock.sendMessage(chat, { text: content || '‎', mentions }, { quoted: msg });
        return sock.sendMessage(chat, { text: `📢 ${content}\n\n${mentions.map(j => `@${jidNumber(j)}`).join(' ')}`, mentions }, { quoted: msg });
      }
      case 'link': {
        const { botAdmin } = await groupContext(sock, chat, sender);
        if (!botAdmin) return reply('The bot must be a group admin to retrieve the invite link.');
        const code = await sock.groupInviteCode(chat);
        return reply(`https://chat.whatsapp.com/${code}`);
      }
      case 'close': case 'open': {
        if (!isOwner(sender)) { const ctx = await groupContext(sock, chat, sender); if (!ctx.isAdmin) return reply('Admin only.'); }
        const { botAdmin } = await groupContext(sock, chat, sender);
        if (!botAdmin) return reply('The bot must be a group admin.');
        await sock.groupSettingUpdate(chat, command === 'close' ? 'announcement' : 'not_announcement');
        return reply(command === 'close' ? '🔒 Only admins can send messages now.' : '🔓 All members can send messages now.');
      }
      case 'kick': case 'promote': case 'demote': {
        if (!isOwner(sender)) { const ctx = await groupContext(sock, chat, sender); if (!ctx.isAdmin) return reply('Admin only.'); }
        const { botAdmin } = await groupContext(sock, chat, sender);
        if (!botAdmin) return reply('The bot must be a group admin.');
        const target = targetFromMessage(msg, args);
        if (!target) return reply(`Tag or reply to a member. Usage: ${config.prefix}${command} @member`);
        if (jidNumber(target) === config.ownerNumber) return reply('The owner cannot be removed or demoted by this command.');
        const action = command === 'kick' ? 'remove' : command;
        await sock.groupParticipantsUpdate(chat, [target], action);
        return reply(`✅ ${command} action submitted for @${jidNumber(target)}.`);
      }
      default: return reply(`Unknown command: ${config.prefix}${command}\nUse ${config.prefix}menu to see available commands.`);
    }
  } catch (error) {
    console.error(`[COMMAND:${command}]`, error?.stack || error);
    return reply(`⚠️ ${error.message || 'Command failed.'}`).catch(() => {});
  }
}
module.exports = { handleMessage, getText };
