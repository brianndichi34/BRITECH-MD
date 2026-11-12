'use strict';
const zlib = require('zlib');
const { jidDecode, jidNormalizedUser } = require('@whiskeysockets/baileys');

const PHONE_USER_SERVERS = new Set(['s.whatsapp.net', 'c.us', 'hosted']);
const LID_USER_SERVERS = new Set(['lid', 'hosted.lid']);
const DIRECT_USER_SERVERS = new Set([...PHONE_USER_SERVERS, ...LID_USER_SERVERS]);

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function createSessionId(creds) {
  if (!creds || typeof creds !== 'object' || !creds.registered || !creds.me?.id) {
    throw new Error('Registered WhatsApp credentials are not available for session export.');
  }
  return 'BRITECH:~' + zlib.deflateSync(Buffer.from(JSON.stringify(creds))).toString('base64');
}

function getVerifiedRecipient(requestedPhone, accountIdentity) {
  const target = normalizePhone(requestedPhone);
  const identity = typeof accountIdentity === 'string' ? { id: accountIdentity } : accountIdentity;
  if (!target || target.length < 10 || target.length > 15) {
    throw new Error('The pairing number is invalid; no session was sent.');
  }
  if (!identity || typeof identity.id !== 'string') {
    throw new Error('The connected WhatsApp account has no valid JID. No session was sent.');
  }

  const accountJid = identity.id;
  const decodedAccount = jidDecode(accountJid);
  const normalizedAccountJid = jidNormalizedUser(accountJid);
  if (!decodedAccount || !normalizedAccountJid || !DIRECT_USER_SERVERS.has(decodedAccount.server)) {
    throw new Error('The connected JID is not a supported direct user address. No session was sent.');
  }

  // A LID is opaque and cannot be parsed as a phone number. For a LID self-ID,
  // require Baileys' paired PN alias (`me.jid`) to verify the requested number.
  const numberAliases = [identity.id, identity.jid]
    .filter(value => typeof value === 'string')
    .map(value => jidDecode(value))
    .filter(decoded => decoded && PHONE_USER_SERVERS.has(decoded.server) && /^\d+$/.test(decoded.user));
  if (!numberAliases.some(decoded => decoded.user === target)) {
    throw new Error('The connected WhatsApp account cannot be verified against the entered phone number. No session was sent.');
  }

  // Use Baileys' canonical direct-user JID. This strips device/agent suffixes,
  // maps legacy @c.us to @s.whatsapp.net, and preserves LID/hosted user domains.
  return normalizedAccountJid;
}

function createDeliveryMessages(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('A non-empty BRITECH MD SESSION_ID is required.');
  }
  return [
    'BRITECH MD SESSION_ID\nYour WhatsApp session is ready. Copy the next message and paste it into SESSION_ID on your bot host. Keep it private.',
    sessionId
  ];
}

module.exports = { normalizePhone, createSessionId, getVerifiedRecipient, createDeliveryMessages };
