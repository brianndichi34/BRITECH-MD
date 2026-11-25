'use strict';

let baileysPromise;

function loadBaileys() {
  if (!baileysPromise) baileysPromise = import('@whiskeysockets/baileys');
  return baileysPromise;
}

module.exports = { loadBaileys };
