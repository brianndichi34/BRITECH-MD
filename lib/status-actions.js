const STATUS_JID = 'status@broadcast';
const recentLikes = new Map();
const inFlight = new Set();
const DEDUPE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function getStatusKey(message) {
  const key = message?.key;
  if (!key || key.remoteJid !== STATUS_JID || !key.id || key.fromMe) return null;
  return key;
}

async function handleStatusMessage(sock, message, config, logger = console) {
  const key = getStatusKey(message);
  if (!key) return { handled: false, viewed: false, liked: false };

  let viewed = false;
  let viewError = null;
  if (config.autoViewStatus) {
    try {
      await sock.readMessages([key]);
      viewed = true;
    } catch (error) {
      viewError = error;
      logger.warn?.({ err: error?.message || error, statusId: key.id }, 'Could not mark WhatsApp status as viewed.');
    }
  }

  let liked = false;
  let likeError = null;
  if (config.autoLikeStatus) {
    if (!key.participant || !sock.user?.id) {
      likeError = new Error('Status author or connected account JID is unavailable.');
      logger.warn?.({ statusId: key.id }, 'Skipped automatic status reaction because a required JID is missing.');
    } else {
      const actionId = `${key.participant}:${key.id}`;
      const now = Date.now();
      for (const [id, time] of recentLikes) if (now - time > DEDUPE_WINDOW_MS) recentLikes.delete(id);
      if (recentLikes.has(actionId) || inFlight.has(actionId)) {
        liked = recentLikes.has(actionId);
      } else {
        inFlight.add(actionId);
        try {
          await sock.sendMessage(STATUS_JID, {
            react: { text: config.statusLikeEmoji || '❤️', key }
          }, {
            statusJidList: [...new Set([key.participant, sock.user.id])]
          });
          recentLikes.set(actionId, now);
          liked = true;
        } catch (error) {
          likeError = error;
          logger.warn?.({ err: error?.message || error, statusId: key.id }, 'Could not automatically react to WhatsApp status.');
        } finally {
          inFlight.delete(actionId);
        }
      }
    }
  }

  return { handled: true, viewed, liked, viewError, likeError };
}

module.exports = { STATUS_JID, getStatusKey, handleStatusMessage };
