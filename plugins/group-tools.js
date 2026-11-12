module.exports = {
  name: 'group-tools',
  category: 'GROUP TOOLS',
  commands: {
    setname: 'Change the group name (group admin only)',
    setdesc: 'Change the group description (group admin only)',
    mute: 'Allow only admins to message the group (group admin only)',
    unmute: 'Allow all members to message the group (group admin only)',
    revoke: 'Renew the group invite link (group admin only)'
  },
  async handle(command, ctx) {
    const { meta, isAdmin, botAdmin } = await ctx.groupContext(ctx.chat, ctx.sender);
    if (!ctx.isOwner(ctx.sender) && !isAdmin) return ctx.reply('Only a group admin or the bot owner can use this command.');

    if (command === 'setname') {
      const name = ctx.query.trim();
      if (!name) return ctx.reply(`Usage: ${ctx.config.prefix}setname New group name`);
      if (name.length > 100) throw new Error('Group name must be 100 characters or fewer.');
      if (!botAdmin) return ctx.reply('Please make BRITECH MD a group admin first.');
      await ctx.sock.groupUpdateSubject(ctx.chat, name);
      return ctx.reply(`Group name changed to: ${name}`);
    }

    if (command === 'setdesc') {
      const description = ctx.query.trim();
      if (!description) return ctx.reply(`Usage: ${ctx.config.prefix}setdesc New group description`);
      if (description.length > 2048) throw new Error('Group description must be 2,048 characters or fewer.');
      if (!botAdmin) return ctx.reply('Please make BRITECH MD a group admin first.');
      await ctx.sock.groupUpdateDescription(ctx.chat, description);
      return ctx.reply('Group description updated.');
    }

    if (command === 'mute' || command === 'unmute') {
      if (!botAdmin) return ctx.reply('Please make BRITECH MD a group admin first.');
      const setting = command === 'mute' ? 'announcement' : 'not_announcement';
      await ctx.sock.groupSettingUpdate(ctx.chat, setting);
      return ctx.reply(command === 'mute' ? 'Group muted: only admins can message.' : 'Group unmuted: all members can message.');
    }

    if (command === 'revoke') {
      if (!botAdmin) return ctx.reply('Please make BRITECH MD a group admin first.');
      const invite = await ctx.sock.groupRevokeInvite(ctx.chat);
      if (!invite) throw new Error('WhatsApp did not return a new group invite link.');
      return ctx.reply(`Old invite link revoked. New link for ${meta.subject}:\nhttps://chat.whatsapp.com/${invite}`);
    }
  }
};
