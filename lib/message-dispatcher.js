const { handleMessage } = require('./handler');
const { STATUS_JID, handleStatusMessage } = require('./status-actions');

async function dispatchUpsert(sock, messages, type, config, logger = console, handlers = {}) {
  if (type !== 'notify') return;
  const commandHandler = handlers.handleMessage || handleMessage;
  const statusHandler = handlers.handleStatusMessage || handleStatusMessage;
  for (const message of messages || []) {
    if (message?.key?.remoteJid === STATUS_JID) {
      await Promise.resolve().then(() => statusHandler(sock, message, config, logger)).catch(error => {
        logger.warn?.({ err: error?.message || error }, 'Automatic status action failed.');
      });
      continue;
    }
    await Promise.resolve().then(() => commandHandler(sock, message)).catch(error => logger.error?.({ err: error?.message || error }, 'Incoming message handler failed.'));
  }
}

module.exports = { dispatchUpsert };
