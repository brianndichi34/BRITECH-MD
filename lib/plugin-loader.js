const fs = require('node:fs');
const path = require('node:path');

function loadPlugins(pluginDir = path.join(__dirname, '..', 'plugins')) {
  if (!fs.existsSync(pluginDir)) return { plugins: [], commands: new Map() };
  const plugins = [];
  const commands = new Map();
  const filenames = fs.readdirSync(pluginDir).filter(name => name.endsWith('.js')).sort();

  for (const filename of filenames) {
    const plugin = require(path.join(pluginDir, filename));
    if (!plugin || typeof plugin !== 'object' || typeof plugin.handle !== 'function' || !plugin.commands || typeof plugin.commands !== 'object') {
      throw new Error(`Invalid command plugin: ${filename}`);
    }
    const name = String(plugin.name || path.basename(filename, '.js'));
    const registered = [];
    for (const [rawCommand, description] of Object.entries(plugin.commands)) {
      const command = rawCommand.toLowerCase();
      if (!/^[a-z][a-z0-9_-]*$/.test(command) || typeof description !== 'string' || !description.trim()) {
        throw new Error(`Invalid command definition in plugin ${name}: ${rawCommand}`);
      }
      if (commands.has(command)) throw new Error(`Duplicate command plugin: ${command}`);
      const entry = { plugin, description: description.trim(), category: String(plugin.category || 'PLUGINS') };
      commands.set(command, entry);
      registered.push(command);
    }
    plugins.push({ name, filename, commands: registered });
  }
  return { plugins, commands };
}

const registry = loadPlugins();

module.exports = {
  loadPlugins,
  plugins: registry.plugins,
  commands: registry.commands,
  descriptions: Object.fromEntries([...registry.commands].map(([name, entry]) => [name, entry.description])),
  get: command => registry.commands.get(String(command || '').toLowerCase()),
  async dispatch(command, context) {
    const entry = registry.commands.get(String(command || '').toLowerCase());
    if (!entry) return false;
    await entry.plugin.handle(String(command).toLowerCase(), context);
    return true;
  },
  async observe(context) {
    for (const plugin of registry.plugins) {
      if (typeof plugin.observe === 'function') await plugin.observe(context);
    }
  },
  categories() {
    const result = {};
    for (const [name, entry] of registry.commands) (result[entry.category] ||= []).push(name);
    return result;
  }
};
