import { REST, Routes, SlashCommandBuilder, ChannelType } from 'discord.js';
import 'dotenv/config';

const bot1Commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hướng dẫn sử dụng bot')
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Gửi hướng dẫn tới kênh này').setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName('agree')
    .setDescription('Chấp nhận điều khoản sử dụng'),
  new SlashCommandBuilder()
    .setName('token')
    .setDescription('Khai báo Discord User Token (được mã hóa)'),
  new SlashCommandBuilder()
    .setName('autoquest')
    .setDescription('Bật/tắt tự động quét và hoàn thành quest')
    .addStringOption((o) =>
      o
        .setName('state')
        .setDescription('on / off')
        .setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
    )
    .addBooleanOption((o) =>
      o.setName('dms').setDescription('Gửi DM khi quest sắp xong / đã claim').setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('auto')
    .setDescription('Chạy một lần: hoàn thành + claim quest pending rồi dừng'),
  new SlashCommandBuilder()
    .setName('quest')
    .setDescription('Chọn quest cụ thể để hoàn thành'),
].map((c) => c.toJSON());

const bot2Commands = [
  new SlashCommandBuilder()
    .setName('addsv')
    .setDescription('Thêm server vào whitelist Bot 02')
    .addStringOption((o) =>
      o.setName('guild_id').setDescription('ID server').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('notification')
    .setDescription('Kênh thông báo khi có quest mới')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Text channel')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    ),
  new SlashCommandBuilder()
    .setName('notiquest')
    .setDescription('Kênh theo dõi tiến độ quest')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Text channel')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    ),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Cấm user khỏi bot')
    .addStringOption((o) =>
      o.setName('user_id').setDescription('Discord User ID').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Lý do cấm').setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('Thời hạn cấm')
        .setRequired(false)
        .addChoices(
          { name: '1 giờ', value: '1h' },
          { name: '6 giờ', value: '6h' },
          { name: '1 ngày', value: '1d' },
          { name: '7 ngày', value: '7d' },
          { name: '30 ngày', value: '30d' },
          { name: 'Vĩnh viễn', value: 'permanent' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Gỡ cấm user')
    .addStringOption((o) =>
      o.setName('user_id').setDescription('Discord User ID').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Thêm Owner')
    .addStringOption((o) =>
      o.setName('user_id').setDescription('Discord User ID').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Thêm Admin')
    .addStringOption((o) =>
      o.setName('user_id').setDescription('Discord User ID').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('reject')
    .setDescription('Gỡ quyền Admin')
    .addStringOption((o) =>
      o.setName('user_id').setDescription('Discord User ID').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('rejecto')
    .setDescription('Gỡ quyền Owner (chỉ chủ bot)')
    .addStringOption((o) =>
      o.setName('user_id').setDescription('Discord User ID').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('test')
    .setDescription('Test gửi quest gần nhất + progress (chỉ OWNER gốc)'),
].map((c) => c.toJSON());

async function main() {
  if (!process.env.BOT1_TOKEN || !process.env.BOT2_TOKEN) {
    console.error('Thiếu BOT1_TOKEN / BOT2_TOKEN');
    process.exit(1);
  }
  if (!process.env.BOT1_CLIENT_ID || !process.env.BOT2_CLIENT_ID) {
    console.error('Thiếu BOT1_CLIENT_ID / BOT2_CLIENT_ID');
    process.exit(1);
  }

  const rest1 = new REST().setToken(process.env.BOT1_TOKEN);
  const rest2 = new REST().setToken(process.env.BOT2_TOKEN);

  console.log('Registering Bot1 commands...');
  await rest1.put(Routes.applicationCommands(process.env.BOT1_CLIENT_ID), { body: bot1Commands });
  console.log('Bot1 OK:', bot1Commands.map((c: any) => c.name).join(', '));

  console.log('Registering Bot2 commands...');
  await rest2.put(Routes.applicationCommands(process.env.BOT2_CLIENT_ID), { body: bot2Commands });
  console.log('Bot2 OK:', bot2Commands.map((c: any) => c.name).join(', '));
}

main().catch(console.error);
