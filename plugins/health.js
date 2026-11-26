const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../lib/config');
const { loadBaileys } = require('../lib/baileys');

const ROOT = path.join(__dirname, '..');

async function inspectHealth(ctx) {
  const issues = [];
  const checks = [];
  const sessionDir = path.resolve(config.sessionDir);
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeMinor = Number(process.versions.node.split('.')[1]);
  const supportedRuntime = nodeMajor > 20 || (nodeMajor === 20 && nodeMinor >= 9);
  checks.push({ name: 'Runtime', ok: supportedRuntime, detail: `Node.js ${process.versions.node} (supported: 20.9+ LTS)` });
  if (!supportedRuntime) issues.push('Select Node.js 20.9+ (or a newer LTS release) in the hosting panel and restart.');

  const connected = Boolean(ctx.sock?.user?.id);
  checks.push({ name: 'WhatsApp link', ok: connected, detail: connected ? 'Linked account is connected' : 'No active linked account identity' });
  if (!connected) issues.push('Check the host console for SESSION_ID import, pairing, timeout, or logged-out errors.');

  let sessionExists = false;
  let credentialsPresent = false;
  try {
    await fs.access(sessionDir);
    sessionExists = true;
    const creds = JSON.parse(await fs.readFile(path.join(sessionDir, 'creds.json'), 'utf8'));
    credentialsPresent = Boolean(creds.registered && creds.me?.id);
  } catch {}
  checks.push({ name: 'Session files', ok: sessionExists && credentialsPresent, detail: credentialsPresent ? 'Auth folder and registered credentials found' : sessionExists ? 'Auth folder exists; registered credentials are missing or unreadable' : 'Auth folder is missing' });
  if (!credentialsPresent) issues.push(process.env.SESSION_ID ? 'A session ID is configured but no registered credentials were found; inspect startup logs and re-import using a clean auth folder only after backing up current files.' : 'No SESSION_ID is configured and no usable auth credentials were found; generate a fresh session.');

  let envExists = false;
  try { await fs.access(path.join(ROOT, '.env')); envExists = true; } catch {}
  checks.push({ name: 'Environment file', ok: envExists, detail: envExists ? 'Root .env exists (values intentionally not displayed)' : 'Root .env is missing' });
  if (!envExists) issues.push('The safe starter .env can be restored with .autofix; add private values on the host and restart.');

  let dependencies = false;
  try { await fs.access(require.resolve('@whiskeysockets/baileys', { paths: [ROOT] })); dependencies = true; } catch {}
  checks.push({ name: 'Baileys dependency', ok: dependencies, detail: dependencies ? 'Installed' : 'Not installed in this runtime' });
  if (!dependencies) issues.push('Install project dependencies with npm install from the project root.');

  const profileFile = path.join(ROOT, 'assets', 'britech-md-avatar.png');
  let avatarPresent = false;
  try { await fs.access(profileFile); avatarPresent = true; } catch {}
  checks.push({ name: 'Menu avatar', ok: avatarPresent, detail: avatarPresent ? 'Generated BRITECH avatar is present' : 'Generated avatar asset is missing' });
  if (!avatarPresent) issues.push('Download the latest BRITECH-MD project files to restore the bundled avatar.');

  checks.push({ name: 'Anti-delete', ok: Boolean(config.autoAntiDelete), detail: config.autoAntiDelete ? 'Enabled; forwards recovered deletions to linked account self-chat' : 'Disabled by AUTO_ANTI_DELETE' });
  checks.push({ name: 'Status automation', ok: Boolean(config.autoViewStatus && config.autoLikeStatus), detail: `View ${config.autoViewStatus ? 'ON' : 'OFF'} / like ${config.autoLikeStatus ? 'ON' : 'OFF'}` });
  checks.push({ name: 'Command reactions', ok: Boolean(config.autoReactCommands), detail: config.autoReactCommands ? `ON (${(config.commandReactionEmojis || []).join(' ') || 'default emoji set'})` : 'OFF' });
  checks.push({ name: 'Manus AI', ok: Boolean(config.manusApiKey), detail: config.manusApiKey ? 'API key configured (value hidden)' : 'Optional; not configured' });

  return { checks, issues, sessionDir };
}

function formatHealth(result, title = 'BRITECH-MD · BOT HEALTH') {
  const lines = [`╭━━━🩺 *${title}* ━━━╮`];
  for (const check of result.checks) lines.push(`${check.ok ? '🟢' : '🟠'} *${check.name}:* ${check.detail}`);
  lines.push('╰━━━━━━━━━━━━━━━━━━━━━━╯');
  if (result.issues.length) {
    lines.push('\n🟠 *WHAT NEEDS ATTENTION*');
    for (const [index, issue] of result.issues.entries()) lines.push(`▫️ ${index + 1}. ${issue}`);
  } else {
    lines.push('\n🟢 *All local checks look good.*');
  }
  lines.push('\n👇 *CHOOSE AN ACTION*');
  lines.push('🔎 Identify Problem  ·  🧰 Auto-fix Safe Issues');
  lines.push('🔒 Auto-fix is owner-only; it never deletes, replaces, or prints WhatsApp session credentials.');
  return lines.join('\n');
}

async function sendDoctorPanel(sock, chat, text) {
  if (typeof sock?.relayMessage !== 'function') return false;
  const { proto, generateMessageIDV2 } = await loadBaileys();
  const content = proto.Message.create({
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: {
          header: proto.Message.InteractiveMessage.Header.create({ title: 'BRITECH-MD · BOT DOCTOR', hasMediaAttachment: false }),
          body: proto.Message.InteractiveMessage.Body.create({ text }),
          footer: proto.Message.InteractiveMessage.Footer.create({ text: 'Select a safe action' }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons: [
            { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Identify Problem', id: '.diagnose' }) },
            { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Auto-fix Safe Issues', id: '.autofix' }) }
          ] })
        }
      }
    }
  });
  await sock.relayMessage(chat, content, { messageId: generateMessageIDV2(sock.user?.id) });
  return true;
}

async function autoFixSafe({ root = ROOT, sessionDir = config.sessionDir } = {}) {
  const actions = [];
  const resolvedSessionDir = path.resolve(sessionDir);
  await fs.mkdir(resolvedSessionDir, { recursive: true });
  try { await fs.chmod(resolvedSessionDir, 0o700); } catch {}
  actions.push('Created/verified the configured auth directory and permissions without changing its contents.');
  const envPath = path.join(root, '.env');
  try {
    await fs.access(envPath);
  } catch {
    const template = await fs.readFile(path.join(root, '.env.example'));
    await fs.writeFile(envPath, template, { flag: 'wx', mode: 0o600 });
    actions.push('Restored a safe root .env starter; it contains no session ID or API keys.');
  }
  try { await fs.chmod(envPath, 0o600); } catch {}
  if (!Array.isArray(config.statusLikeEmojis) || !config.statusLikeEmojis.length) {
    config.statusLikeEmoji = '💕';
    config.statusLikeEmojis = ['💕', '💞', '💖', '💯', '🥰'];
    actions.push('Restored the in-memory status reaction emoji defaults.');
  }
  if (!Array.isArray(config.commandReactionEmojis) || !config.commandReactionEmojis.length) {
    config.commandReactionEmojis = ['💕', '💞', '💖', '💯', '🥰'];
    config.autoReactCommands = true;
    actions.push('Restored the in-memory command reaction defaults and enabled acknowledgements.');
  }
  return actions;
}

module.exports = {
  name: 'health-and-safe-repair',
  category: 'HEALTH',
  commands: {
    doctor: 'Open Bot Doctor with Identify Problem and Auto-fix Safe Issues buttons',
    diagnose: 'Identify common runtime, session, configuration, and deployment problems',
    autofix: 'Apply safe local repairs without touching session credentials (owner only)'
  },
  inspectHealth,
  formatHealth,
  sendDoctorPanel,
  autoFixSafe,
  async handle(command, ctx) {
    if (command === 'doctor') {
      const result = await inspectHealth(ctx);
      await ctx.reply(formatHealth(result));
      const summary = result.issues.length ? `🟠 ${result.issues.length} item(s) need attention. Choose an action to continue.` : '🟢 Local checks look good. Choose an action to run checks again or repair safe local issues.';
      try { if (await sendDoctorPanel(ctx.sock, ctx.chat, summary)) return; } catch (error) {
        console.warn('[BOT_DOCTOR:buttons]', error?.message || error);
      }
      return ctx.reply('Buttons are unavailable in this connection. Use .diagnose or .autofix instead.');
    }
    if (command === 'diagnose') {
      const result = await inspectHealth(ctx);
      return ctx.reply(formatHealth(result));
    }
    if (command === 'autofix') {
      if (!ctx.isOwner(ctx.sender)) return ctx.reply('Only the bot owner can run automatic repairs.');
      const actions = await autoFixSafe();
      const result = await inspectHealth(ctx);
      const summary = actions.length ? actions.map((action, i) => `${i + 1}. ${action}`).join('\n') : 'No safe local repairs were needed.';
      return ctx.reply(`🧰 SAFE AUTO-FIX RESULTS\n${summary}\n\n${formatHealth(result, 'POST-FIX CHECK')}`);
    }
  }
};
