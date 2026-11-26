'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Keep the WhatsApp auth directory private after every Baileys credential write.
 * Symlinks are not followed, so permissions cannot be redirected outside the
 * configured session directory.
 */
function secureSessionDirectory(sessionDir) {
  const root = path.resolve(sessionDir);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const visit = current => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    fs.chmodSync(current, 0o700);
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) fs.chmodSync(target, 0o600);
    }
  };
  visit(root);
  return root;
}

module.exports = { secureSessionDirectory };
