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
import { QuestNotifier } from '../workers/quest-notifier';
import { decrypt } from '../utils/crypto';
import { QuestEngine } from '../engine/quest-engine';

export const bot2 = new Client({
  intents: [GatewayIntentBits.Guilds],
});

let questNotifier: QuestNotifier;

bot2.once(Events.ClientReady, async (c) => {
  console.log(`[Bot2] Logged in as ${c.user.tag}`);
  try {
    questNotifier = new QuestNotifier(bot2);
    questNotifier.start();

    const initial = (process.env.INITIAL_GUILD_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const gid of initial) {
      try {
        if (!(await servers.isAllowed(gid))) {
          await servers.add(gid, process.env.OWNER_ID || 'system');
          console.log(`[Bot2] Auto-whitelisted guild from env: ${gid}`);
        }
      } catch (e: any) {
        console.error(`[Bot2] whitelist env ${gid}:`, e?.message || e);
      }
    }

    try {
      if ((await servers.list()).length === 0 && c.guilds.cache.size > 0) {
        for (const [guildId, guild] of c.guilds.cache) {
          await servers.add(guildId, process.env.OWNER_ID || 'system');
          console.log(`[Bot2] First-run: auto-whitelisted ${guild.name} (${guildId})`);
        }
      }
    } catch (e: any) {
      console.error('[Bot2] first-run whitelist:', e?.message || e);
    }

    for (const [guildId, guild] of c.guilds.cache) {
      try {
        if (!(await servers.isAllowed(guildId))) {
          console.log(`[Bot2] Leaving unauthorized guild: ${guild.name} (${guildId})`);
          await guild.leave().catch(() => {});
        }
      } catch (e: any) {
        console.error(`[Bot2] check guild ${guildId}:`, e?.message || e);
      }
    }
  } catch (e: any) {
    console.error('[Bot2] ClientReady error:', e?.message || e);
  }
});

bot2.on(Events.GuildCreate, async (guild) => {
  try {
    if (!(await servers.isAllowed(guild.id))) {
      console.log(`[Bot2] Auto-leaving unauthorized guild: ${guild.name} (${guild.id})`);
      await guild.leave().catch(() => {});
    }
  } catch (e: any) {
    console.error(`[Bot2] GuildCreate ${guild.id}:`, e?.message || e);
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
  const isOwner = await staff.isOwner(userId);
  const isAdmin = await staff.isAdminOrOwner(userId);

  if ((commandName === 'rejecto' || commandName === 'test') && !isSuperOwner) {
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
    await servers.add(guildId, userId);
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
    await settings.set('notification_channel', channel.id);
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
    await settings.set('notiquest_channel', channel.id);
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
    const reason = interaction.options.getString('reason') || 'Không có lý do';
    const duration = interaction.options.getString('duration') || 'permanent';

    let expiresAt: string | null = null;
    let durationLabel = 'Vĩnh viễn';
    if (duration !== 'permanent') {
      const map: Record<string, number> = {
        '1h': 3600_000,
        '6h': 6 * 3600_000,
        '1d': 86400_000,
        '7d': 7 * 86400_000,
        '30d': 30 * 86400_000,
      };
      const ms = map[duration];
      if (ms) {
        expiresAt = new Date(Date.now() + ms).toISOString();
        durationLabel = duration;
      }
    }

    await users.upsert(targetId);
    await users.setBanned(targetId, true, {
      reason,
      expiresAt,
      bannedBy: userId,
    });

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('Đã cấm người dùng')
      .addFields(
        { name: 'User', value: `<@${targetId}> (\`${targetId}\`)`, inline: false },
        { name: 'Lý do', value: reason, inline: false },
        { name: 'Thời hạn', value: durationLabel, inline: true },
        {
          name: 'Hết hạn',
          value: expiresAt
            ? `<t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:F> (<t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:R>)`
            : 'Vĩnh viễn',
          inline: true,
        },
        { name: 'Người cấm', value: `<@${userId}>`, inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    // DM target
    try {
      const u = await bot2.users.fetch(targetId);
      const dm = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('Bạn đã bị cấm sử dụng bot')
        .addFields(
          { name: 'Lý do', value: reason },
          {
            name: 'Hết hạn',
            value: expiresAt
              ? `<t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:R>`
              : 'Vĩnh viễn',
          },
          { name: 'Người cấm', value: `<@${userId}>` },
        )
        .setTimestamp();
      await u.send({ embeds: [dm] });
    } catch {
      /* DM closed */
    }
    return;
  }

  // ---------- /unban ----------
  if (commandName === 'unban') {
    const targetId = interaction.options.getString('user_id', true);
    await users.setBanned(targetId, false);
    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Đã gỡ cấm')
      .setDescription(`<@${targetId}> (\`${targetId}\`) có thể dùng bot lại (cần \`/agree\` nếu chưa).`)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    try {
      const u = await bot2.users.fetch(targetId);
      await u.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('Bạn đã được gỡ cấm')
            .setDescription('Bạn có thể sử dụng bot trở lại.')
            .setTimestamp(),
        ],
      });
    } catch { /* ignore */ }
    return;
  }

  // ---------- /owner ----------
  if (commandName === 'owner') {
    const targetId = interaction.options.getString('user_id', true);
    await staff.add(targetId, 'owner', userId);
    try {
      const u = await bot2.users.fetch(targetId);
      await u.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('Bạn đã được bổ nhiệm')
            .setDescription(`Bạn được bổ nhiệm **Owner**. Người thực hiện: <@${userId}>.`)
            .setTimestamp(),
        ],
      });
    } catch { /* ignore */ }

    await interaction.reply({
      content: `✅ Đã thêm \`${targetId}\` làm **Owner**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ---------- /admin ----------
  if (commandName === 'admin') {
    const targetId = interaction.options.getString('user_id', true);
    await staff.add(targetId, 'admin', userId);
    try {
      const u = await bot2.users.fetch(targetId);
      await u.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('Bạn đã được bổ nhiệm')
            .setDescription(`Bạn được bổ nhiệm **Admin**. Người thực hiện: <@${userId}>.`)
            .setTimestamp(),
        ],
      });
    } catch { /* ignore */ }

    await interaction.reply({
      content: `✅ Đã thêm \`${targetId}\` làm **Admin**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ---------- /reject ----------
  if (commandName === 'reject') {
    const targetId = interaction.options.getString('user_id', true);
    const target = await staff.get(targetId);
    if (!target || target.role !== 'admin') {
      await interaction.reply({ content: '❌ User này không phải Admin.', flags: MessageFlags.Ephemeral });
      return;
    }
    await staff.remove(targetId);
    await interaction.reply({
      content: `✅ Đã gỡ Admin của \`${targetId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    try {
      const u = await bot2.users.fetch(targetId);
      await u.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('Bạn đã bị giáng chức')
            .setDescription(`Quyền **Admin** đã bị gỡ bởi <@${userId}>.`)
            .setTimestamp(),
        ],
      });
    } catch { /* ignore */ }
    return;
  }

  // ---------- /rejecto ----------
  if (commandName === 'rejecto') {
    const targetId = interaction.options.getString('user_id', true);
    if (targetId === process.env.OWNER_ID) {
      await interaction.reply({ content: '❌ Không thể gỡ chủ sở hữu bot.', flags: MessageFlags.Ephemeral });
      return;
    }
    const target = await staff.get(targetId);
    if (!target || target.role !== 'owner') {
      await interaction.reply({ content: '❌ User này không phải Owner.', flags: MessageFlags.Ephemeral });
      return;
    }
    await staff.remove(targetId);
    await interaction.reply({
      content: `✅ Đã gỡ Owner của \`${targetId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // ---------- /test (OWNER_ID only) ----------
  if (commandName === 'test') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!questNotifier) {
      await interaction.editReply({ content: '❌ Notifier chưa sẵn sàng.' });
      return;
    }

    const notiResult = await questNotifier.testNearestQuest(userId);

    let progressMsg = '';
    try {
      const notiId = await settings.get('notiquest_channel');
      if (!notiId) {
        progressMsg = 'Chưa set kênh `/notiquest`.';
      } else {
        const ch = await bot2.channels.fetch(notiId);
        if (!ch || !ch.isTextBased()) {
          progressMsg = 'Kênh notiquest không hợp lệ.';
        } else {
          let token: string | null = null;
          const u = await users.get(userId);
          if (u?.encrypted_token) {
            try {
              token = decrypt(u.encrypted_token);
            } catch {
              /* ignore */
            }
          }
          if (!token) {
            const tracked = await users.getTrackedUsers();
            for (const row of tracked) {
              if (!row.encrypted_token) continue;
              try {
                token = decrypt(row.encrypted_token);
                break;
              } catch {
                /* ignore */
              }
            }
          }

          let questName = 'Test Quest';
          let progress = 0;
          let target = 100;
          if (token) {
            try {
              const engine = new QuestEngine(token);
              const list = (await engine.loadQuests())
                .filter((q) => !q.isExpired() && q.id !== '1412491570820812933')
                .sort(
                  (a, b) =>
                    new Date(b.raw.config.starts_at || 0).getTime() -
                    new Date(a.raw.config.starts_at || 0).getTime(),
                );
              if (list[0]) {
                questName = list[0].name;
                progress = list[0].getProgress();
                target = list[0].getTarget() || 100;
              }
            } catch {
              /* keep defaults */
            }
          }

          const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
          const size = 12;
          const filled = Math.min(size, Math.round((pct / 100) * size));
          const bar = '█'.repeat(filled) + '░'.repeat(size - filled);

          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setAuthor({ name: '🔄  In Progress' })
            .setTitle(questName.slice(0, 256))
            .setDescription('`' + bar + '`  **' + pct + '%**')
            .addFields({
              name: 'Progress',
              value: `**${progress}** / **${target}**`,
              inline: true,
            })
            .setFooter({ text: 'Flow test — /test' })
            .setTimestamp();

          await ch.send({
            content: `<@${userId}>`,
            embeds: [embed],
            allowedMentions: { users: [userId] },
          });
          progressMsg = `Đã gửi progress **${questName}** vào notiquest.`;
        }
      }
    } catch (e: any) {
      progressMsg = `Lỗi progress: ${e?.message || e}`;
    }

    const line1 = notiResult.ok
      ? `✅ ${notiResult.message}`
      : `⚠️ Notification: ${notiResult.message}`;
    const line2 = progressMsg.startsWith('Đã')
      ? `✅ ${progressMsg}`
      : `⚠️ ${progressMsg}`;
    await interaction.editReply({ content: `${line1}
${line2}` });
    return;
  }
}
