# Discord Auto Quest Duo Bot

> **Mục đích giáo dục / học tập.**  
> Việc dùng **user token** để tự động hoàn thành Discord Quest **vi phạm Discord Terms of Service**.  
> Người dùng tự chịu rủi ro (có thể bị hạn chế hoặc ban tài khoản).  

---

## Tổng quan

Hệ thống gồm **2 bot Discord** tách biệt:

| Bot | Vai trò | Ai dùng |
|-----|---------|---------|
| **Bot 01** | Người dùng cuối — khai báo token, chạy quest | Mọi user đã `/agree` |
| **Bot 02** | Quản trị — whitelist server, kênh thông báo, ban, phân quyền | Owner / Admin |

- Quest engine gọi **REST API** với user token (không dùng Gateway selfbot chung với bot).
- Token user được **mã hóa AES-256-GCM** trước khi lưu.
- Bot 02 **tự rời** server không nằm trong whitelist.

---

## Yêu cầu

- Node.js **≥ 18**
- 2 ứng dụng bot trên [Discord Developer Portal](https://discord.com/developers/applications)
- User token Discord (chỉ dùng tài khoản phụ / học tập)

---

## Cài đặt

### 1. Cài dependency

```bash
npm install
```

### 2. Cấu hình `.env`

```bash
cp .env.example .env
```

| Biến | Mô tả |
|------|--------|
| `BOT1_TOKEN` | Token Bot 01 (user-facing) |
| `BOT2_TOKEN` | Token Bot 02 (admin) |
| `BOT1_CLIENT_ID` | Application ID Bot 01 |
| `BOT2_CLIENT_ID` | Application ID Bot 02 |
| `OWNER_ID` | Discord User ID chủ bot (super owner) |
| `ENCRYPTION_KEY` | 64 ký tự hex (32 bytes) — khóa mã hóa token |
| `INITIAL_GUILD_IDS` | ID server admin, cách nhau bằng dấu phẩy (whitelist Bot 02 lúc start) |

Tạo `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Privileged Intents (Developer Portal)

Với **cả 2 bot**, mục **Bot → Privileged Gateway Intents**:

- Có thể chỉ cần intents mặc định; code hiện dùng `Guilds`.
- Nếu sau này bật thêm intent privileged → phải bật tương ứng trên portal.

### 4. Mời bot vào server

**OAuth2 → URL Generator:**

- Scopes: `bot` + `applications.commands`
- Permissions gợi ý: `Send Messages`, `Embed Links`, `Use Application Commands`

Mời **Bot 02** vào đúng server có ID trong `INITIAL_GUILD_IDS`.

### 5. Đăng ký slash command

```bash
npm run register
```

### 6. Chạy

```bash
npm run dev
```

---

## Lệnh

### Bot 01 — Người dùng

| Lệnh | Mô tả |
|------|--------|
| `/agree` | Đọc và chấp nhận điều khoản sử dụng |
| `/token` | Nhập Discord **user token** (lưu dạng mã hóa) |
| `/autoquest` `on` / `off` | Bật / tắt chạy quest liên tục; tùy chọn `dms` |
| `/auto` | Chạy **một lần** toàn bộ quest pending rồi dừng |
| `/quest` | Hiện danh sách quest → chọn quest cụ thể để làm |

**Thứ tự dùng:** `/agree` → `/token` → `/auto` / `/autoquest` / `/quest`.

### Bot 02 — Quản trị

| Lệnh | Quyền | Mô tả |
|------|--------|--------|
| `/addsv` | Admin+ | Thêm server vào whitelist Bot 02 |
| `/notification` | Admin+ | Đặt kênh thông báo quest mới |
| `/notiquest` | Admin+ | Đặt kênh theo dõi tiến độ quest (live embed) |
| `/ban` | Admin+ | Cấm user khỏi bot |
| `/unban` | Admin+ | Gỡ cấm |
| `/admin` | Admin+ | Thêm Admin |
| `/owner` | Owner | Thêm Owner |
| `/reject` | Owner | Gỡ Admin |
| `/rejecto` | Super owner (`OWNER_ID`) | Gỡ Owner |

---

## Luồng hoạt động

```
User /agree → tos_accepted
User /token → token mã hóa lưu data/hieutool.json

/auto hoặc /autoquest hoặc /quest
  → giải mã token
  → REST: GET /quests/@me
  → enroll (nếu cần)
  → Watch Video: POST video-progress
  → Play Desktop: POST heartbeat
  → claim-reward
  → cập nhật embed trên kênh /notiquest (nếu đã set)
```

### Loại quest hỗ trợ

| Loại | Hỗ trợ |
|------|--------|
| Watch Video / Mobile | Có |
| Play on Desktop | Có (heartbeat ~60s) |
| Stream / Activity / Xbox / PlayStation | Bỏ qua |

---

## Cấu trúc thư mục

```
hieutool-bot/
├── src/
│   ├── bots/
│   │   ├── bot1.ts          # Bot người dùng
│   │   └── bot2.ts          # Bot quản trị
│   ├── engine/
│   │   └── quest-engine.ts  # REST-only, user token
│   ├── workers/
│   │   └── quest-worker.ts  # Worker đa user + live embed
│   ├── database/
│   │   └── index.ts         # JSON store (data/hieutool.json)
│   ├── utils/
│   │   └── crypto.ts        # AES-256-GCM
│   ├── register-commands.ts
│   └── index.ts
├── data/                    # Tự tạo khi chạy
├── .env.example
├── package.json
└── README.md
```

---

## Phân tách kỹ thuật

| Thành phần | Thư viện | Ghi chú |
|------------|----------|---------|
| Bot 01 / 02 | `discord.js` | Bot token + Gateway, `intents: Guilds` |
| Quest engine | `fetch` thuần | User token + REST, **không** mở Gateway, **không** patch `WebSocketShard` |

Hai lớp này tách biệt để bot chính thức không bị nhiễm Identify kiểu user client.

---

## Scripts

| Lệnh | Mô tả |
|------|--------|
| `npm run dev` | Chạy cả 2 bot (tsx + `.env`) |
| `npm run register` | Đăng ký / cập nhật slash commands |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Chạy bản build |

---

## Lưu ý bảo mật

1. **Không** commit file `.env` hoặc `data/`.
2. Token user chỉ nên dùng trên tài khoản phụ.
3. `ENCRYPTION_KEY` mất = không giải mã được token đã lưu.
4. Không chia sẻ user token cho bất kỳ ai.

---

## Giấy phép / trách nhiệm
Dự án phục vụ mục đích **học hỏi** API Discord, mã hóa, dual-bot và worker pattern.  

KHÔNG chịu trách nhiệm nếu tài khoản bị Discord xử lý do vi phạm ToS.

Dự án được Fork từ repo https://github.com/Nguoibianhz/Discord-Auto-Quests

Giấy phép General Public License v3.0 