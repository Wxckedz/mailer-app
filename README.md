# Wxcked Mailer v2

A full-featured email & Telegram campaign platform optimized for low-resource VPS environments (1GB RAM+).

## Features

- **Email Sending** — SMTP with proxy rotation, spoof name/email, connection pooling
- **Telegram Bot** — Full bot integration with multi-step commands, inline keyboards
- **Web Dashboard** — Modern dark-themed SPA with live preview, brand templates, mass mailer
- **IMAP Inbox Viewer** — Fetch and parse emails from connected IMAP accounts
- **Scheduled Sends** — Cron-based scheduling with timezone support
- **Brand Template Library** — 150+ templates from top brands (Google, Microsoft, Apple, etc.)
- **Scan History** — Track detected wallets, seed phrases, and crypto findings
- **Team Management** — Role-based access control for Telegram members
- **Memory Optimized** — Designed for 1GB RAM VPS with GC, caching, and memory monitoring

## Requirements

- **Node.js** >= 18 (tested on v24)
- **npm** >= 8
- **pm2** (for production process management)
- **2GB RAM** recommended (runs on 1GB, 2GB is comfortable)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Edit `.env` with your credentials:

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=@your_chat_id

# Admin Telegram Username (without @)
ADMIN_TELEGRAM_USERNAME=your_username

# Default SMTP Configuration
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=your_resend_key

# Server Configuration
PORT=3000
```

### 3. Start the Application

**Development (direct):**
```bash
npm start
```

**Production (pm2):**
```bash
npm run pm2
```

### 4. Verify

Open `http://localhost:3000` in your browser.

- **Web Panel:** `http://localhost:3000`
- **Login:** `admin` / `admin123` (change immediately after first login)
- **API:** `http://localhost:3000/api/...`

## Deployment

### Production Setup with pm2

```bash
# Install pm2 globally (if not already)
npm install -g pm2

# Start the app
npm run pm2

# Check status
pm2 status

# View logs
npm run pm2:logs

# Restart
npm run pm2:restart

# Stop
npm run pm2:stop

# Monitor
npm run pm2:monit
```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Firewall (ufw)

```bash
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw enable
```

## Project Structure

```
mailer-app/
├── server.js              # Entry point
├── ecosystem.config.js    # PM2 process config
├── package.json
├── .env                   # Environment variables
├── public/
│   └── index.html         # Frontend SPA (single file)
├── src/
│   ├── config.js          # Configuration & constants
│   ├── storage.js         # JSON file storage with caching
│   ├── auth.js            # Session-based authentication
│   ├── smtp.js            # SMTP transport & proxy rotation
│   ├── telegram.js        # Telegram bot handlers
│   ├── templates.js       # Email template builders
│   ├── memory.js          # Memory monitoring & error handlers
│   ├── rateLimit.js       # In-memory rate limiter
│   └── api/
│       └── routes.js      # Express API routes
├── data/                  # JSON data files (auto-created)
│   ├── users.json
│   ├── settings.json
│   ├── smtp-configs.json
│   ├── proxies.json
│   ├── templates.json
│   ├── imap-configs.json
│   ├── schedules.json
│   ├── scan-history.json
│   ├── brand-templates.json
│   ├── team.json
│   └── users/             # Per-user data
└── logs/                  # PM2 logs
```

## API Endpoints

All API routes are prefixed with `/api` and require authentication (except `/auth/login`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with username/password |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user info |
| GET | `/api/status` | System status |
| GET | `/api/settings` | Get settings |
| POST | `/api/settings` | Update settings |
| GET | `/api/smtp-configs` | List SMTP configs |
| POST | `/api/smtp-configs` | Add/update SMTP config |
| DELETE | `/api/smtp-configs/:id` | Delete SMTP config |
| POST | `/api/smtp-test` | Test SMTP connection |
| GET | `/api/imap-configs` | List IMAP configs |
| POST | `/api/imap-configs` | Add/update IMAP config |
| POST | `/api/imap-fetch` | Fetch emails via IMAP |
| GET | `/api/templates` | List user templates |
| POST | `/api/templates` | Create/update template |
| POST | `/api/templates/preview` | Preview template with variables |
| GET | `/api/brand-templates` | List brand templates |
| POST | `/api/brand-templates/custom` | Add custom brand templates |
| GET | `/api/proxies` | List proxies |
| POST | `/api/proxies` | Add proxy |
| DELETE | `/api/proxies/:id` | Delete proxy |
| POST | `/api/send-email` | Send single email |
| POST | `/api/send-mass` | Send mass email |
| POST | `/api/send-template` | Send template email |
| POST | `/api/send-combined` | Send email + Telegram |
| POST | `/api/send-telegram` | Send Telegram message |
| GET | `/api/schedules` | List schedules |
| POST | `/api/schedules` | Create schedule |
| GET | `/api/scan-history` | List scan history |
| POST | `/api/scan-history` | Add scan finding |
| GET | `/api/scan-history/export` | Export scan history as CSV |
| GET | `/api/team` | List team members |
| POST | `/api/team/invite` | Invite team member |
| GET | `/api/users` | List web panel users |
| POST | `/api/users` | Add web panel user |
| DELETE | `/api/users/:id` | Delete web panel user |
| GET | `/api/sender-config` | Get sender config |
| POST | `/api/sender-config` | Update sender config |
| POST | `/api/upload-profile-pic` | Upload profile picture |
| GET | `/api/profile-pic/:userId` | Get profile picture |

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot |
| `/help` | Show all commands |
| `/menu` | Show main menu |
| `/send` | Send an email (multi-step) |
| `/mass` | Send mass emails (multi-step) |
| `/ledger` | Send Ledger template email |
| `/yahoo` | Send Yahoo template email |
| `/status` | Check system status |
| `/templates` | List saved templates |
| `/settings` | View current settings |
| `/setledger` | Customize Ledger template (admin) |
| `/setyahoo` | Customize Yahoo template (admin) |
| `/setsender` | Set sender email domain & prefix |
| `/login` | View web panel login & sender email |
| `/adduser` | Add web panel user (admin) |
| `/removeuser` | Remove web panel user (admin) |
| `/users` | List web panel users (admin) |
| `/addmember` | Add Telegram member (admin) |
| `/removemember` | Remove Telegram member (admin) |
| `/members` | List Telegram members (admin) |
| `/link` | Link Telegram to web panel account |
| `/uploadhtml` | Upload HTML template |
| `/sendhtml` | Send HTML template |
| `/setprofilepic` | Set sender profile picture |
| `/setname` | Set sender name |
| `/setspoofemail` | Set spoofed email |
| `/cancel` | Cancel current operation |

## Testing

```bash
# Run the test suite (server must be running)
node test-final.js
```

## License

Proprietary software.