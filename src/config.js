require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');
const SMTP_CONFIGS_FILE = path.join(DATA_DIR, 'smtp-configs.json');
const IMAP_CONFIGS_FILE = path.join(DATA_DIR, 'imap-configs.json');
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const SCAN_HISTORY_FILE = path.join(DATA_DIR, 'scan-history.json');
const PROXIES_FILE = path.join(DATA_DIR, 'proxies.json');
const BRAND_TEMPLATES_FILE = path.join(DATA_DIR, 'brand-templates.json');
const TEAM_FILE = path.join(DATA_DIR, 'team.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SHARED_SMTP_FILE = path.join(DATA_DIR, 'shared-smtp.json');

fs.ensureDirSync(DATA_DIR);
['templates.json','smtp-configs.json','imap-configs.json','schedules.json','scan-history.json','proxies.json','brand-templates.json','team.json','users.json','settings.json','shared-smtp.json'].forEach(f => {
  const fp = path.join(DATA_DIR, f);
  if (!fs.existsSync(fp)) {
    if (f === 'users.json') fs.writeJsonSync(fp, [{ id: '1', username: 'admin', password: 'admin123', role: 'admin', telegramId: '', telegramChatId: '', createdAt: new Date().toISOString() }]);
    else if (f === 'settings.json') fs.writeJsonSync(fp, {});
    else if (f === 'shared-smtp.json') {
      // Empty - admin will add Hostinger SMTPs via Telegram
      fs.writeJsonSync(fp, []);
    }
    else fs.writeJsonSync(fp, []);
  }
});

// Hostinger SMTP Configuration
const HOSTINGER_SMTP = {
  host: 'smtp.hostinger.com',
  port: 587,
  secure: false, // STARTTLS — same as the Telegram bot
};

// Shared SMTP domains will be loaded from shared-smtp.json (admin-managed)
const SHARED_SMTP_DOMAINS = [];

const ADMIN_USERNAME = (process.env.ADMIN_TELEGRAM_USERNAME || '@icyfeel').toLowerCase().replace('@', '');
const PORT = process.env.PORT || 3000;
const HOSTINGER_USER = process.env.HOSTINGER_USER || '';
const HOSTINGER_PASS = process.env.HOSTINGER_PASS || '';
const HOSTINGER_DOMAIN = process.env.HOSTINGER_DOMAIN || '';

// Memory safety limits for 1GB VPS
const MAX_BODY_SIZE = '5mb';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TG_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MEMORY_WARN_MB = 700;
const MEMORY_CRITICAL_MB = 850;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120;

module.exports = {
  DATA_DIR, TEMPLATES_FILE, SMTP_CONFIGS_FILE, IMAP_CONFIGS_FILE,
  SCHEDULES_FILE, SCAN_HISTORY_FILE, PROXIES_FILE, BRAND_TEMPLATES_FILE,
  TEAM_FILE, USERS_FILE, SETTINGS_FILE, SHARED_SMTP_FILE,
  SHARED_SMTP_DOMAINS, HOSTINGER_SMTP, ADMIN_USERNAME, PORT,
  HOSTINGER_USER, HOSTINGER_PASS, HOSTINGER_DOMAIN,
  MAX_BODY_SIZE, SESSION_TTL_MS, TG_SESSION_TTL_MS,
  MEMORY_WARN_MB, MEMORY_CRITICAL_MB,
  RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX,
  getSharedSmtpConfigs: () => SHARED_SMTP_DOMAINS,
};
