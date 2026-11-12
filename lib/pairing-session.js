'use strict';
const zlib = require('zlib');

function normalizePhone(value) {
  return String(value || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function createSessionId(creds) {
  if (!creds || typeof creds !== 'object' || !creds.registered || !creds.me?.id) {
    throw new Error('Registered WhatsApp credentials are not available for session export.');
  }
  return 'BRITECH:~' + zlib.deflateSync(Buffer.from(JSON.stringify(creds))).toString('base64');
}

function getVerifiedRecipient(requestedPhone, accountJid) {
  const target = normalizePhone(requestedPhone);
  const account = normalizePhone(accountJid);
  if (!target || target.length < 10 || target.length > 15) {
    throw new Error('The pairing number is invalid; no session was sent.');
  }
  if (!account || account !== target) {
    throw new Error('The connected WhatsApp account does not match the entered number. No session was sent.');
  }
  return target + '@s.whatsapp.net';
}

function createDeliveryMessages(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.startsWith('BRITECH:~')) {
    throw new Error('A valid BRITECH MD SESSION_ID is required.');
  }
  return [
    'BRITECH MD SESSION_ID\nYour WhatsApp session is ready. Copy the next message and paste it into SESSION_ID on your bot host. Keep it private.',
    sessionId
  ];
}

module.exports = { normalizePhone, createSessionId, getVerifiedRecipient, createDeliveryMessages };
