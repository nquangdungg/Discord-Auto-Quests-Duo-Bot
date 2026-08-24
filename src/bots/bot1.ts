import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  Interaction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { users } from '../database';
import { encrypt } from '../utils/crypto';
import { QuestWorkerManager } from '../workers/quest-worker';

export const bot1 = new Client({
  intents: [GatewayIntentBits.Guilds],
});

bot1.commands = new Collection();
let workerManager: QuestWorkerManager;

function tosEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Điều khoản sử dụng')
    .setDescription(
      [
        'Đây là công cụ **học tập / giáo dục**.',
        '',
        '• Dùng **user token** tự động hoàn thành Quest **vi phạm Discord ToS**.',
        '• Bạn **tự chịu rủi ro** bị hạn chế hoặc ban tài khoản.',
        '• Lạm dụng (spam, bán token, chia sẻ token, thương mại trái phép…) → **ban vĩnh viễn**.',
        '• Chỉ chủ bot có quyền ban người dùng.',
        '• Token được **mã hóa AES-256-GCM**, không log plaintext.',
        '',
        'Nhấn **Đồng ý** nếu bạn đã đọc và chấp nhận.',
      ].join('\n'),
    )
    .setTimestamp();
}

function requireAccess(userId: string) {
  return users.canUseBot(userId);
}

bot1.once(Events.ClientReady, (c) => {
  console.log(`[Bot1] Logged in as ${c.user.tag}`);
  workerManager = new QuestWorkerManager(bot1);
});

bot1.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isButton()) await handleButton(interaction);
    else if (interaction.isModalSubmit()) await handleModal(interaction);
    else if (interaction.isStringSelectMenu()) await handleSelect(interaction);
  } catch (err) {
    console.error('[Bot1] Interaction error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: 'Đã xảy ra lỗi nội bộ.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

async function handleCommand(interaction: ChatInputCommandInteraction) {
  const { commandName, user } = interaction;

  if (commandName === 'agree') {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('tos_accept')
        .setLabel('Đồng ý')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('tos_reject')
        .setLabel('Từ chối')
        .setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({
      embeds: [tosEmbed()],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const check = requireAccess(user.id);
  if (!check.ok) {
    await interaction.reply({ content: `❌ ${check.reason}`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (commandName === 'token') {
    const modal = new ModalBuilder().setCustomId('modal_token').setTitle('Nhập Discord User Token');
    const input = new TextInputBuilder()
      .setCustomId('token_value')
      .setLabel('User Token')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Dán token vào đây…')
      .setRequired(true)
      .setMinLength(50)
      .setMaxLength(200);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (commandName === 'autoquest') {
    const state = interaction.options.getString('state', true);
    const dms = interaction.options.getBoolean('dms') ?? false;

    if (state === 'off') {
      const stopped = workerManager?.stop(user.id) ?? false;
      users.setAutoQuest(user.id, false, dms);
      await interaction.reply({
        content: stopped ? '⏹️ Đã dừng AutoQuest.' : 'Không có AutoQuest đang chạy.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await workerManager.startAutoQuest(user.id, dms);
    await interaction.editReply({ content: result.message });
    return;
  }

  if (commandName === 'auto') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await workerManager.runOnce(user.id);
    await interaction.editReply({ content: result.message });
    return;
  }

  if (commandName === 'quest') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const list = await workerManager.listPending(user.id);
    if (!list.ok || !list.quests) {
      await interaction.editReply({ content: `❌ ${list.message || 'Không lấy được danh sách quest.'}` });
      return;
    }
    if (list.quests.length === 0) {
      await interaction.editReply({ content: '✨ Không có quest pending.' });
      return;
    }

    const options = list.quests.slice(0, 25).map((q) => ({
      label: q.name.slice(0, 100),
      description: `${q.taskIcon} ${q.getRewardLabel()} • còn ${q.getRemaining()}s`.slice(0, 100),
      value: q.id,
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('quest_select')
      .setPlaceholder('Chọn quest muốn hoàn thành…')
      .setMinValues(1)
      .setMaxValues(Math.min(options.length, 10))
      .addOptions(options);

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Quest đang chờ')
      .setDescription(
        list.quests
          .slice(0, 15)
          .map(
            (q, i) =>
              `**${i + 1}.** ${q.taskIcon} **${q.name}**\n└ \`${q.getRewardLabel()}\` · còn **${q.getRemaining()}s**`,
          )
          .join('\n\n'),
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    });
    return;
  }

  await interaction.reply({
    content: `Lệnh \`/${commandName}\` không khả dụng.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleButton(interaction: ButtonInteraction) {
  if (interaction.customId === 'tos_reject') {
    await interaction.update({
      content: 'Bạn đã từ chối điều khoản. Không thể dùng bot.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (interaction.customId === 'tos_accept') {
    users.upsert(interaction.user.id);
    users.setTosAccepted(interaction.user.id, true);
    users.setLicensed(interaction.user.id, true, null); // keep field, no key system

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('Đã chấp nhận điều khoản')
      .setDescription('Tiếp theo dùng `/token` để khai báo user token, rồi `/auto` · `/autoquest` · `/quest`.')
      .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });
  }
}

async function handleModal(interaction: ModalSubmitInteraction) {
  if (interaction.customId !== 'modal_token') return;

  const token = interaction.fields.getTextInputValue('token_value').trim();
  const userId = interaction.user.id;
  const check = requireAccess(userId);
  if (!check.ok) {
    await interaction.reply({ content: `❌ ${check.reason}`, flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    users.setToken(userId, encrypt(token));
    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('Token đã lưu')
      .setDescription('Token đã được mã hóa.\nBạn có thể dùng `/autoquest`, `/auto` hoặc `/quest`.')
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } catch (e: any) {
    await interaction.reply({
      content: `❌ Lỗi lưu token: ${e?.message || 'unknown'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleSelect(interaction: StringSelectMenuInteraction) {
  if (interaction.customId !== 'quest_select') return;

  const check = requireAccess(interaction.user.id);
  if (!check.ok) {
    await interaction.reply({ content: `❌ ${check.reason}`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  const result = await workerManager.runSelected(interaction.user.id, interaction.values);
  await interaction.followUp({ content: result.message, flags: MessageFlags.Ephemeral });
}

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, any>;
  }
}
