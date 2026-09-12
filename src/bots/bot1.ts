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
  TextChannel,
} from 'discord.js';
import { users } from '../database';
import { encrypt } from '../utils/crypto';
import { QuestWorkerManager } from '../workers/quest-worker';

export const bot1 = new Client({
  intents: [GatewayIntentBits.Guilds],
});

bot1.commands = new Collection();
export let workerManager: QuestWorkerManager;

function tosEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Điều khoản sử dụng')
    .setDescription(
      [
        'Công cụ **học tập / giáo dục**.',
        '',
        '• Dùng **user token** tự động Quest **vi phạm Discord ToS**.',
        '• Bạn **tự chịu rủi ro** bị hạn chế / ban tài khoản.',
        '• Lạm dụng → **ban khỏi bot**.',
        '• Token **mã hóa AES-256-GCM**, không lưu plaintext.',
        '',
        'Nhấn **Đồng ý** nếu đã đọc và chấp nhận.',
      ].join('\n'),
    )
    .setTimestamp();
}

function helpEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Hướng dẫn sử dụng bot')
    .setDescription('Bot hỗ trợ hoàn thành Discord Quest (mục đích học tập).')
    .addFields(
      {
        name: '1️⃣ Bắt đầu',
        value: [
          '`/agree` — chấp nhận điều khoản',
          '`/token` — nhập Discord **user token** (đã mã hóa)',
        ].join('\n'),
      },
      {
        name: '2️⃣ Quest',
        value: [
          '`/autoquest on|off [dms]` — bật/tắt tự động quét & làm quest (lưu DB, restart vẫn chạy)',
          '`/auto` — làm **một lần** mọi quest pending rồi dừng',
          '`/quest` — chọn quest cụ thể để làm',
        ].join('\n'),
      },
      {
        name: '3️⃣ Thứ tự',
        value: '`/agree` → `/token` → `/auto` / `/autoquest` / `/quest`',
      },
      {
        name: '⚠️ Lưu ý',
        value: 'User token chỉ dùng acc phụ. Vi phạm ToS Discord — tự chịu rủi ro.',
      },
    )
    .setFooter({ text: 'Bot1 — User commands' })
    .setTimestamp();
}

async function requireAccess(userId: string) {
  return users.canUseBot(userId);
}

bot1.once(Events.ClientReady, async (c) => {
  console.log(`[Bot1] Logged in as ${c.user.tag}`);
  // channelClient = bot2 (notiquest nằm server admin)
  const { bot2 } = await import('./bot2');
  workerManager = new QuestWorkerManager(bot1, bot2);
  setTimeout(() => void workerManager.resumeFromDatabase(), 4000);
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
      new ButtonBuilder().setCustomId('tos_accept').setLabel('Đồng ý').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('tos_reject').setLabel('Từ chối').setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({
      embeds: [tosEmbed()],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (commandName === 'help') {
    const channel = interaction.options.getChannel('channel');
    const embed = helpEmbed();
    if (channel && channel.isTextBased()) {
      await (channel as TextChannel).send({ embeds: [embed] });
      await interaction.reply({
        content: `✅ Đã gửi hướng dẫn tới ${channel}.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    return;
  }

  const check = await requireAccess(user.id);
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
      const stopped = workerManager ? await workerManager.stop(user.id) : false;
      if (!stopped) {
        await users.setAutoQuest(user.id, false, dms);
      }
      await interaction.reply({
        content: '⏹️ Đã tắt AutoQuest (đã lưu DB).',
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
      value: q.id,
      description: `${q.getRewardLabel()} • còn ${q.getRemaining()}`.slice(0, 100),
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('quest_select')
      .setPlaceholder('Chọn quest…')
      .setMinValues(1)
      .setMaxValues(Math.min(options.length, 10))
      .addOptions(options);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Quest pending')
      .setDescription(`Có **${list.quests.length}** quest. Chọn quest để bot thực hiện.`)
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    });
    return;
  }

  await interaction.reply({ content: 'Lệnh không hỗ trợ.', flags: MessageFlags.Ephemeral });
}

async function handleButton(interaction: ButtonInteraction) {
  if (interaction.customId === 'tos_accept') {
    await users.upsert(interaction.user.id);
    await users.setTosAccepted(interaction.user.id, true);
    await users.setLicensed(interaction.user.id, true, null);
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('Đã chấp nhận ToS')
          .setDescription('Tiếp theo dùng `/token` để liên kết tài khoản.')
          .setTimestamp(),
      ],
      components: [],
    });
    return;
  }
  if (interaction.customId === 'tos_reject') {
    await interaction.update({
      content: 'Bạn đã từ chối điều khoản. Không thể dùng bot.',
      embeds: [],
      components: [],
    });
  }
}

async function handleModal(interaction: ModalSubmitInteraction) {
  if (interaction.customId !== 'modal_token') return;
  const token = interaction.fields.getTextInputValue('token_value').trim();
  if (token.length < 50) {
    await interaction.reply({ content: '❌ Token không hợp lệ.', flags: MessageFlags.Ephemeral });
    return;
  }
  const check = await requireAccess(interaction.user.id);
  if (!check.ok) {
    await interaction.reply({ content: `❌ ${check.reason}`, flags: MessageFlags.Ephemeral });
    return;
  }
  await users.setToken(interaction.user.id, encrypt(token));
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('Đã lưu token')
        .setDescription('Token đã mã hóa. Dùng `/auto`, `/autoquest` hoặc `/quest`.')
        .setTimestamp(),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSelect(interaction: StringSelectMenuInteraction) {
  if (interaction.customId !== 'quest_select') return;
  const check = await requireAccess(interaction.user.id);
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
