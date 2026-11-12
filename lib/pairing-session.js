'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { createCompactSessionId } = require('./session-id');
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
  return 'BRITECH:~' + zlib.deflateSync(Buffer.from(JSON.stringify(creds)), { level: 9 }).toString('base64url');
}

function createArchiveSessionId(archive) {
  if (!Buffer.isBuffer(archive) || archive.length < 4 || archive[0] !== 0x50 || archive[1] !== 0x4b) {
    throw new Error('A valid ZIP auth archive is required to create an archive SESSION_ID.');
  }
  return 'BRITECH2:' + zlib.deflateRawSync(archive, { level: 9 }).toString('base64url');
}

async function createAuthArchiveSessionId(sessionDir) {
  const root = path.resolve(sessionDir);
  const credsPath = path.join(root, 'creds.json');
  const creds = JSON.parse(await fs.promises.readFile(credsPath, 'utf8'));
  if (!creds.registered || !creds.me?.id) throw new Error('Registered WhatsApp credentials are required to export the auth folder.');
  const files = [];
  async function addDirectory(current, relative = '') {
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in the WhatsApp auth folder.');
      if (entry.isDirectory()) await addDirectory(fullPath, relPath);
      else if (entry.isFile()) files.push({ path: relPath, data: await fs.promises.readFile(fullPath) });
    }
  }
  await addDirectory(root);
  return createCompactSessionId(files);
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function createSessionDocx(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('A non-empty SESSION_ID is required for the Word document.');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>BRITECH MD SESSION_ID</w:t></w:r></w:p><w:p><w:r><w:t>Copy the complete value below into the SESSION_ID environment variable. Keep it private.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">' + xmlEscape(sessionId) + '</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

async function sendAndConfirm(sock, recipient, payload, timeoutMs = 12000) {
  const pending = new Map();
  const earlyUpdates = new Map();
  const listener = updates => {
    for (const item of updates || []) {
      const id = item?.key?.id;
      if (!id) continue;
      const acknowledged = Number(item.update?.status) >= 2;
      if (pending.has(id)) pending.get(id)(acknowledged);
      else earlyUpdates.set(id, acknowledged);
    }
  };
  sock.ev?.on?.('messages.update', listener);
  try {
    const result = await sock.sendMessage(recipient, payload);
    const id = result?.key?.id;
    if (!id) return { id: '', acknowledged: false };
    if (earlyUpdates.has(id)) return { id, acknowledged: earlyUpdates.get(id) };
    const acknowledged = await new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve(false); }, timeoutMs);
      pending.set(id, value => { clearTimeout(timer); pending.delete(id); resolve(value); });
    });
    return { id, acknowledged };
  } finally {
    sock.ev?.removeListener?.('messages.update', listener);
    for (const resolve of pending.values()) resolve(false);
  }
}

async function deliverSession(sock, recipient, sessionId) {
  const [notice, ...sessionParts] = createDeliveryMessages(sessionId);
  let documentId = '';
  let documentSent = false;
  let documentError = '';
  let noticeSent = false;
  let textSent = false;
  let textError = '';
  try {
    const document = await createSessionDocx(sessionId);
    const result = await sendAndConfirm(sock, recipient, {
      document,
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: 'BRITECH-MD-SESSION_ID.docx',
      caption: 'BRITECH MD SESSION_ID — Word document attached. Keep it private.'
    });
    documentId = result.id;
    documentSent = result.acknowledged;
    if (!documentSent) documentError = 'No WhatsApp server acknowledgement for the SESSION_ID Word document.';
  } catch (error) {
    documentError = error?.message || 'The SESSION_ID Word document could not be sent.';
  }

  try {
    noticeSent = (await sendAndConfirm(sock, recipient, { text: notice })).acknowledged;
  } catch {}
  try {
    const results = [];
    for (const part of sessionParts) results.push(await sendAndConfirm(sock, recipient, { text: part }));
    textSent = results.length > 0 && results.every(result => result.acknowledged);
    if (!textSent) textError = 'One or more plain-text SESSION_ID messages received no WhatsApp server acknowledgement.';
  } catch (error) {
    textError = error?.message || 'Plain-text SESSION_ID messages were rejected.';
  }

  if (!documentSent && !textSent) {
    throw new Error(`WhatsApp did not confirm delivery of either SESSION_ID format. ${documentError} ${textError}`.trim());
  }
  return { documentId, documentSent, documentError, noticeSent, textSent, textError };
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

  // Send to the verified phone-number address, not the account's opaque LID.
  // This targets the WhatsApp DM the user entered and lets WhatsApp resolve it
  // to any linked-device/LID identity. Preserve hosted PN domains if supplied.
  const phoneAlias = [identity.jid, identity.id]
    .filter(value => typeof value === 'string')
    .map(value => ({ raw: value, decoded: jidDecode(value) }))
    .find(({ decoded }) => decoded && PHONE_USER_SERVERS.has(decoded.server) && decoded.user === target);
  if (!phoneAlias) throw new Error('The entered number has no verified WhatsApp phone JID. No session was sent.');
  return jidNormalizedUser(phoneAlias.raw);
}

function createDeliveryMessages(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('A non-empty BRITECH MD SESSION_ID is required.');
  }
  const chunkSize = 12000;
  const parts = [];
  for (let offset = 0; offset < sessionId.length; offset += chunkSize) parts.push(sessionId.slice(offset, offset + chunkSize));
  return [
    'BRITECH MD SESSION_ID\nYour WhatsApp session is ready. Copy the following message' + (parts.length > 1 ? 's in order and join them with no spaces or line breaks' : '') + '. Paste the complete value into SESSION_ID on your bot host. Keep it private.',
    ...parts
  ];
}

module.exports = { normalizePhone, createSessionId, createArchiveSessionId, createAuthArchiveSessionId, createSessionDocx, deliverSession, getVerifiedRecipient, createDeliveryMessages, sendAndConfirm };
