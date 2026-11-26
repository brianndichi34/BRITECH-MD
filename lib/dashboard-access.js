'use strict';

const crypto = require('crypto');

function isProtected(token) {
  return Boolean(String(token || '').trim());
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function isAuthorized(configuredToken, authorizationHeader) {
  if (!isProtected(configuredToken)) return true;
  const supplied = String(authorizationHeader || '').replace(/^Bearer\s+/i, '');
  return safeEqual(supplied, String(configuredToken).trim());
}

module.exports = { isProtected, isAuthorized };
