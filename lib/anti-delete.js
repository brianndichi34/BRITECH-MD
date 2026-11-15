const { WAMessageStubType } = require('@whiskeysockets/baileys');

const STATUS_JID = 'status@broadcast';
const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000;
const DEFAULT_MAX_MESSAGES = 1000;

function canonicalJid(jid = '') {
  const [user, server = ''] = String(jid).split('@');
  return user && server ? `${user.split(':')[0]}@${server}` : '';
}

function messageCacheKey(key) {
  if (!key?.remoteJid || !key?.id) return null;
  return `${key.remoteJid}|${key.id}`;
}

function messageTime(message) {
  const seconds = Number(message?.messageTimestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return new Date(seconds * 1000).toISOString();
}

function pairedAccountJid(sock, ownerNumber) {
  // The linked account's PN or LID is its WhatsApp self-chat target.
  const ownJid = sock?.user?.id || sock?.user?.lid;
  if (typeof ownJid === 'string' && /@(s\.whatsapp\.net|lid)$/.test(ownJid)) return canonicalJid(ownJid);
  const digits = String(ownerNumber || '').replace(/\D/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function createAntiDelete({ ttlMs = DEFAULT_TTL_MS, maxMessages = DEFAULT_MAX_MESSAGES } = {}) {
  const messages = new Map();
  const processed = new Map();

  function prune(now = Date.now()) {
    for (const [key, entry] of messages) {
      if (now - entry.cachedAt > ttlMs) messages.delete(key);
    }
    for (const [key, time] of processed) {
      if (now - time > ttlMs) processed.delete(key);
    }
    while (messages.size > maxMessages) messages.delete(messages.keys().next().value);
  }

  function remember(sock, incomingMessages, config) {
    if (!config?.autoAntiDelete) return 0;
    const ownJids = new Set([
      `${String(config.ownerNumber || '').replace(/\D/g, '')}@s.whatsapp.net`,
      canonicalJid(sock?.user?.id),
      canonicalJid(sock?.user?.lid)
    ].filter(Boolean));
    const now = Date.now();
    prune(now);
    let added = 0;
    for (const message of incomingMessages || []) {
      const key = message?.key;
      const cacheKey = messageCacheKey(key);
      if (!cacheKey || !message.message || key.remoteJid === STATUS_JID) continue;
      if (ownJids.has(canonicalJid(key.remoteJid))) continue;
      if (message.message.protocolMessage) continue;
      messages.set(cacheKey, {
        key: { ...key },
        message: message.message,
        messageTimestamp: message.messageTimestamp,
        pushName: message.pushName,
        cachedAt: now
      });
      added++;
    }
    prune(now);
    return added;
  }

  function findCached(key) {
    const exact = messageCacheKey(key);
    if (exact && messages.has(exact)) return [exact, messages.get(exact)];
    if (!key?.id) return [null, null];
    for (const [cacheKey, value] of messages) {
      if (value.key.id === key.id && value.key.remoteJid === key.remoteJid) return [cacheKey, value];
    }
    return [null, null];
  }

  async function handleUpdates(sock, updates, config, logger = console) {
    if (!config?.autoAntiDelete) return 0;
    const ownerNumber = String(config.ownerNumber || '').replace(/\D/g, '');
    const ownerJid = pairedAccountJid(sock, ownerNumber);
    if (!ownerJid) {
      logger.warn?.('Anti-delete cannot resolve the linked account self-chat JID.');
      return 0;
    }
    let recovered = 0;

    for (const event of updates || []) {
      if (event?.update?.messageStubType !== WAMessageStubType.REVOKE) continue;
      const targetKey = event.key;
      if (targetKey?.remoteJid === STATUS_JID || event.update?.key?.remoteJid === STATUS_JID) continue;
      const dedupeKey = messageCacheKey(targetKey);
      if (!dedupeKey) continue;
      prune();
      if (processed.has(dedupeKey)) continue;
      const [cacheKey, original] = findCached(targetKey);
      const sourceChat = targetKey.remoteJid || 'Unknown chat';
      const isGroup = sourceChat.endsWith('@g.us');
      const senderJid = original?.key?.participant || original?.key?.remoteJid || 'Unknown sender';
      const deleteEventKey = event.update.key;
      const deleterJid = deleteEventKey?.participant || deleteEventKey?.remoteJid || 'Unknown';
      const lines = [
        'Deleted WhatsApp message recovered',
        `${isGroup ? 'Group' : 'Chat'}: ${sourceChat}`,
        `Original sender: ${original?.pushName ? `${original.pushName} (${senderJid})` : senderJid}`,
        `Deleted by: ${deleterJid}`
      ];
      const sentAt = messageTime(original);
      if (sentAt) lines.push(`Original time: ${sentAt}`);
      lines.push(original ? 'Recovered content follows.' : 'Content was not cached while the bot was online.');

      try {
        await sock.sendMessage(ownerJid, { text: lines.join('\n') });
        if (original) {
          await sock.sendMessage(ownerJid, { forward: original, force: true });
          if (cacheKey) messages.delete(cacheKey);
          processed.set(dedupeKey, Date.now());
          recovered++;
          logger.info?.({ sourceChat, messageId: targetKey.id }, 'Forwarded a deleted message to the owner DM.');
        } else {
          processed.set(dedupeKey, Date.now());
          logger.warn?.({ sourceChat, messageId: targetKey.id }, 'Deletion received, but original message was not in cache.');
        }
      } catch (error) {
        logger.warn?.({ err: error?.message || error, sourceChat, messageId: targetKey.id }, 'Could not forward deleted message to the owner DM.');
      }
    }
    prune();
    return recovered;
  }

  return { remember, handleUpdates, cacheSize: () => messages.size };
}

module.exports = { createAntiDelete, messageCacheKey, pairedAccountJid, DEFAULT_TTL_MS, DEFAULT_MAX_MESSAGES };
