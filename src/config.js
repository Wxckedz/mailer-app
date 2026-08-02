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

fs.ensureDirSync(DATA_DIR);
['templates.json','smtp-configs.json','imap-configs.json','schedules.json','scan-history.json','proxies.json','brand-templates.json','team.json','users.json','settings.json'].forEach(f => {
  const fp = path.join(DATA_DIR, f);
  if (!fs.existsSync(fp)) {
    if (f === 'users.json') fs.writeJsonSync(fp, [{ id: '1', username: 'admin', password: 'admin123', role: 'admin', telegramId: '', telegramChatId: '', createdAt: new Date().toISOString() }]);
    else if (f === 'settings.json') fs.writeJsonSync(fp, {});
    else fs.writeJsonSync(fp, []);
  }
});

const SHARED_SMTP_DOMAINS = [
  {
    id: 'shared_irnna',
    name: 'irnna.com (Shared)',
    host: process.env.SHARED_SMTP_HOST || 'smtp.resend.com',
    port: parseInt(process.env.SHARED_SMTP_PORT) || 465,
    secure: true,
    user: process.env.SHARED_SMTP_USER || 'resend',
    pass: process.env.SHARED_SMTP_PASS || 'nod',
    domain: 'irnna.com',
    spoofName: '',
    spoofEmail: '',
    isShared: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'shared_banorte',
    name: 'smtp-banorte.com (Shared)',
    host: process.env.SHARED_SMTP_HOST || 'smtp.resend.com',
    port: parseInt(process.env.SHARED_SMTP_PORT) || 465,
    secure: true,
    user: process.env.SHARED_SMTP_USER || 'resend',
    pass: process.env.SHARED_SMTP_PASS || '',
    domain: 'smtp-banorte.com',
    spoofName: '',
    spoofEmail: '',
    isShared: true,
    createdAt: new Date().toISOString()
  }
];

const ADMIN_USERNAME = (process.env.ADMIN_TELEGRAM_USERNAME || '@icyfeel').toLowerCase().replace('@', '');
const PORT = process.env.PORT || 3000;

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
  TEAM_FILE, USERS_FILE, SETTINGS_FILE,
  SHARED_SMTP_DOMAINS, ADMIN_USERNAME, PORT,
  MAX_BODY_SIZE, SESSION_TTL_MS, TG_SESSION_TTL_MS,
  MEMORY_WARN_MB, MEMORY_CRITICAL_MB,
  RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX,
  getSharedSmtpConfigs: () => SHARED_SMTP_DOMAINS,
};