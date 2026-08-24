import {
  Client,
  GatewayIntentBits,
  Events,
  Interaction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
} from 'discord.js';
import { staff, servers, settings, users } from '../database';

export const bot2 = new Client({
  intents: [GatewayIntentBits.Guilds],
});

bot2.once(Events.ClientReady, async (c) => {
  console.log(`[Bot2] Logged in as ${c.user.tag}`);

  const initial = (process.env.INITIAL_GUILD_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const gid of initial) {
    if (!servers.isAllowed(gid)) {
      servers.add(gid, process.env.OWNER_ID || 'system');
      console.log(`[Bot2] Auto-whitelisted guild from env: ${gid}`);
    }
  }

  if (servers.list().length === 0 && c.guilds.cache.size > 0) {
    for (const [guildId, guild] of c.guilds.cache) {
      servers.add(guildId, process.env.OWNER_ID || 'system');
      console.log(`[Bot2] First-run: auto-whitelisted ${guild.name} (${guildId})`);
    }
  }

  for (const [guildId, guild] of c.guilds.cache) {
    if (!servers.isAllowed(guildId)) {
      console.log(`[Bot2] Leaving unauthorized guild: ${guild.name} (${guildId})`);
      await guild.leave().catch(() => {});
    }
  }
});

bot2.on(Events.GuildCreate, async (guild) => {
  if (!servers.isAllowed(guild.id)) {
    console.log(`[Bot2] Auto-leaving unauthorized guild: ${guild.name} (${guild.id})`);
    await guild.leave().catch(() => {});
  }
});

bot2.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    await handleAdminCommand(interaction);
  } catch (err) {
    console.error('[Bot2] Interaction error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: 'Đã xảy ra lỗi nội bộ.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

async function handleAdminCommand(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const { commandName } = interaction;

  const isSuperOwner = userId === process.env.OWNER_ID;
  const isOwner = staff.isOwner(userId);
  const isAdmin = staff.isAdminOrOwner(userId);

  if (commandName === 'rejecto' && !isSuperOwner) {
    await interaction.reply({
      content: '❌ Chỉ chủ sở hữu bot mới dùng được lệnh này.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (['owner', 'reject'].includes(commandName) && !isOwner && !isSuperOwner) {
    await interaction.reply({
      content: '❌ Chỉ Owner mới dùng được lệnh này.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isAdmin && !isSuperOwner) {
    await interaction.reply({
      content: '❌ Bạn không có quyền quản trị.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ---------- /addsv ----------
  if (commandName === 'addsv') {
    const guildId = interaction.options.getString('guild_id', true);
    servers.add(guildId, userId);
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('Đã thêm server')
      .setDescription(`\`${guildId}\` đã vào whitelist Bot 02.`)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- /notification ----------
  if (commandName === 'notification') {
    const channel = interaction.options.getChannel('channel');
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: '❌ Chọn một text channel.', flags: MessageFlags.Ephemeral });
      return;
    }
    settings.set('notification_channel', channel.id);
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Kênh thông báo quest mới')
      .setDescription(`Đã đặt: <#${channel.id}>`)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- /notiquest ----------
  if (commandName === 'notiquest') {
    const channel = interaction.options.getChannel('channel');
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: '❌ Chọn một text channel.', flags: MessageFlags.Ephemeral });
      return;
    }
    settings.set('notiquest_channel', channel.id);
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Kênh theo dõi tiến độ')
      .setDescription(`Đã đặt: <#${channel.id}>`)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- /ban ----------
  if (commandName === 'ban') {
    const targetId = interaction.options.getString('user_id', true);
    users.upsert(targetId);
    users.setBanned(targetId, true);
    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('Đã cấm người dùng')
      .setDescription(`\`${targetId}\` không còn dùng được bot.`)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- /unban ----------
  if (commandName === 'unban') {
    const targetId = interaction.options.getString('user_id', true);
    users.setBanned(targetId, false);
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('Đã gỡ cấm')
      .setDescription(`\`${targetId}\` có thể dùng bot lại (cần \`/agree\` nếu chưa).`)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- /owner ----------
  if (commandName === 'owner') {
    const targetId = interaction.options.getString('user_id', true);
    staff.add(targetId, 'owner', userId);
    await interaction.reply({
      content: `✅ Đã thêm \`${targetId}\` làm **Owner**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ---------- /admin ----------
  if (commandName === 'admin') {
    const targetId = interaction.options.getString('user_id', true);
    staff.add(targetId, 'admin', userId);
    await interaction.reply({
      content: `✅ Đã thêm \`${targetId}\` làm **Admin**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ---------- /reject ----------
  if (commandName === 'reject') {
    const targetId = interaction.options.getString('user_id', true);
    const target = staff.get(targetId);
    if (!target || target.role !== 'admin') {
      await interaction.reply({ content: '❌ User này không phải Admin.', flags: MessageFlags.Ephemeral });
      return;
    }
    staff.remove(targetId);
    await interaction.reply({
      content: `✅ Đã gỡ Admin của \`${targetId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ---------- /rejecto ----------
  if (commandName === 'rejecto') {
    const targetId = interaction.options.getString('user_id', true);
    if (targetId === process.env.OWNER_ID) {
      await interaction.reply({ content: '❌ Không thể gỡ chủ sở hữu bot.', flags: MessageFlags.Ephemeral });
      return;
    }
    const target = staff.get(targetId);
    if (!target || target.role !== 'owner') {
      await interaction.reply({ content: '❌ User này không phải Owner.', flags: MessageFlags.Ephemeral });
      return;
    }
    staff.remove(targetId);
    await interaction.reply({
      content: `✅ Đã gỡ Owner của \`${targetId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}
