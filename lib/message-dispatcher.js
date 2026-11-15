const { handleMessage } = require('./handler');
const { STATUS_JID, handleStatusMessage } = require('./status-actions');

async function dispatchUpsert(sock, messages, type, config, logger = console, handlers = {}) {
  const commandHandler = handlers.handleMessage || handleMessage;
  const statusHandler = handlers.handleStatusMessage || handleStatusMessage;
  const pending = [];
  for (const message of messages || []) {
    if (message?.key?.remoteJid === STATUS_JID) {
      pending.push(Promise.resolve().then(() => statusHandler(sock, message, config, logger)).catch(error => {
        logger.warn?.({ err: error?.message || error }, 'Automatic status action failed.');
      }));
      continue;
    }
    if (type !== 'notify') continue;
    pending.push(Promise.resolve().then(() => commandHandler(sock, message)).catch(error => logger.error?.({ err: error?.message || error }, 'Incoming message handler failed.')));
  }
  await Promise.all(pending);
}

module.exports = { dispatchUpsert };
