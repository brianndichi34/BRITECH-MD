const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const runExecFile = promisify(execFile);
const root = path.join(__dirname, '..');

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

async function runNpm(args, runner = runExecFile) {
  return runner('npm', args, { cwd: root, timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
}

async function outdatedDependencies(runner = runNpm) {
  let output = '';
  try {
    ({ stdout: output } = await runner(['outdated', '--json', '--no-fund', '--no-audit']));
  } catch (error) {
    // npm outdated exits with status 1 when it found outdated packages; its JSON is useful output.
    output = error.stdout || '';
    if (!output.trim()) throw error;
  }
  let parsed;
  try { parsed = JSON.parse(output || '{}'); }
  catch { throw new Error('Could not parse npm outdated results. Try again from the host console.'); }
  return Object.entries(parsed).map(([name, versions]) => ({
    name,
    current: versions.current || 'not installed',
    wanted: versions.wanted || 'unknown',
    latest: versions.latest || 'unknown'
  }));
}

async function handle(command, ctx) {
  if (command === 'uptime') return ctx.reply(`⏱️ Bot process uptime: ${formatUptime(process.uptime())}`);
  if (command === 'runtime') return ctx.reply(`🩺 Runtime diagnostics\nNode.js: ${process.version}\nPlatform: ${process.platform} (${process.arch})\nBot process uptime: ${formatUptime(process.uptime())}\nRequired: Node.js 20.9+ (or newer LTS)`);
  if (command === 'jid') return ctx.reply(`🔎 Chat JID: ${ctx.chat || 'unknown'}\nYour sender JID: ${ctx.sender || 'unknown'}`);

  if (!ctx.isOwner(ctx.sender)) return ctx.reply('🔒 Only the bot owner can check or install dependency updates.');
  const action = String(ctx.args?.[0] || 'deps').toLowerCase();
  if (!['deps', 'check'].includes(action)) return ctx.reply(`Usage: ${ctx.config.prefix}update [check|deps]\n• check: list compatible dependency updates\n• deps (default): apply package.json-compatible updates`);

  if (action === 'check') {
    try {
      const updates = await outdatedDependencies();
      if (!updates.length) return ctx.reply('✅ All installed npm dependencies are current within their declared version ranges.');
      return ctx.reply(`📦 Dependency updates available:\n${updates.map(item => `• ${item.name}: ${item.current} → ${item.wanted} (latest ${item.latest})`).join('\n')}\n\nRun ${ctx.config.prefix}update deps as owner to install wanted versions.`);
    } catch (error) {
      return ctx.reply(`⚠️ Could not check npm updates: ${error.message || 'unknown error'}`);
    }
  }

  await ctx.reply('⏳ Updating npm dependencies allowed by package.json… Keep the bot host online.');
  try {
    const { stdout, stderr } = await runNpm(['update', '--no-audit', '--no-fund']);
    const summary = `${stdout || ''}\n${stderr || ''}`.trim().split('\n').filter(Boolean).slice(-8).join('\n');
    return ctx.reply(`✅ Dependency update finished.${summary ? `\n${summary}` : ''}\n\nRestart the bot from your host panel to load updated packages. This does not change the bot's source code or WhatsApp session.`);
  } catch (error) {
    const details = `${error.stdout || ''}\n${error.stderr || ''}`.trim().split('\n').filter(Boolean).slice(-6).join('\n');
    return ctx.reply(`⚠️ Dependency update failed: ${error.message || 'npm error'}${details ? `\n${details}` : ''}\nNo WhatsApp session files are modified.`);
  }
}

module.exports = {
  name: 'maintenance-and-diagnostics',
  category: 'MAINTENANCE',
  commands: {
    uptime: 'Show how long the bot process has been running',
    runtime: 'Show Node.js and platform health details',
    jid: 'Show the current chat and sender JIDs for diagnostics',
    update: 'Owner-only: check or install compatible npm dependency updates'
  },
  handle,
  formatUptime,
  outdatedDependencies,
  runNpm
};
