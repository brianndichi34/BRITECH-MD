'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ASSET_DIR = path.join(__dirname, '..', 'assets');
const CUSTOM_AVATAR_PATH = path.join(ASSET_DIR, 'menu-profile.jpg');
const DEFAULT_AVATAR_PATH = path.join(ASSET_DIR, 'britech-md-avatar.png');

/**
 * Return the exact image used by .menu and by automatic WhatsApp profile setup.
 * A downloaded owner-selected image takes precedence over the bundled logo.
 */
function getBotAvatarPath() {
  if (fs.existsSync(CUSTOM_AVATAR_PATH)) return CUSTOM_AVATAR_PATH;
  if (fs.existsSync(DEFAULT_AVATAR_PATH)) return DEFAULT_AVATAR_PATH;
  return null;
}

function hasBotAvatar() {
  return Boolean(getBotAvatarPath());
}

module.exports = {
  ASSET_DIR,
  CUSTOM_AVATAR_PATH,
  DEFAULT_AVATAR_PATH,
  getBotAvatarPath,
  hasBotAvatar
};
