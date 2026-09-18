const { ADMIN_USERNAME, TG_SESSION_TTL_MS, HOSTINGER_SMTP } = require('./config');
const {
  readJSON, readJSONSync, writeJSON,
  USERS_FILE
} = require('./storage');
const {
  getSharedSmtpConfigs, addSharedSmtpConfig, deleteSharedSmtpConfig
} = require('./smtp');

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

function isRegisteredUser(username, chatId) {
  if (!username && !chatId) return false;
  const users = readJSONSync(USERS_FILE);
  
  if (chatId) {
    const byChat = users.find(u => u.telegramChatId && String(u.telegramChatId) === String(chatId));
    if (byChat) return true;
  }
  
  if (username) {
    const clean = username.toLowerCase().replace('@', '');
    if (clean === ADMIN_USERNAME) return true;
    return users.some(u => u.telegramId && u.telegramId.toLowerCase().replace('@', '') === clean);
  }
  
  return false;
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
    [{ text: '🔗 Link Account', callback_data: 'link' }],
    [{ text: '🔐 My Credentials', callback_data: 'credentials' }],
    [{ text: '📊 Status', callback_data: 'status' }],
  ];
  if (isAdminUser) {
    rows.push([
      { text: '👤 Add User', callback_data: 'adduser' },
      { text: '❌ Remove User', callback_data: 'removeuser' },
    ]);
    rows.push([
      { text: '👤 Users List', callback_data: 'users' },
    ]);
    rows.push([
      { text: '📬 Add Hostinger SMTP', callback_data: 'addsmtp' },
      { text: '📋 List SMTPs', callback_data: 'listsmtps' },
    ]);
    rows.push([
      { text: '🗑️ Delete SMTP', callback_data: 'deletesmtp' },
    ]);
  }
  return { reply_markup: { inline_keyboard: rows } };
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
    const chatId = msg.chat.id;
    
    await bot.answerCallbackQuery(callbackQuery.id);
    
    switch (data) {
      case 'link':
        tgSessions.set(chatId, { step: 'link_username', createdAt: Date.now() });
        await bot.sendMessage(chatId, '🔗 *Link Telegram to Web Panel*\n\nStep 1/2: Enter your web panel username:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
        
      case 'credentials': {
        const user = findUserByChatId(chatId) || findUserByTelegram(username);
        if (!user) {
          return bot.sendMessage(chatId, '❌ Your Telegram is not linked to any account.\n\nUse /link to connect your web panel account.');
        }
        bot.sendMessage(chatId, 
          `🔐 *Your Web Panel Credentials*\n\n` +
          `👤 Username: \`${user.username}\`\n` +
          `🔑 Password: \`${user.password}\`\n\n` +
          `🌐 *Panel URL:* Your domain\n\n` +
          `⚠️ Keep these credentials secure!`, 
          { parse_mode: 'Markdown' }
        );
        break;
      }
      
      case 'status': {
        const users = await readJSON(USERS_FILE);
        const smtps = getSharedSmtpConfigs();
        const status = `📊 *System Status*\n\n` +
          `🖥️ Server: ✅ Running\n` +
          `📬 Hostinger SMTPs: ${smtps.length}\n` +
          `👤 Registered Users: ${users.length}\n` +
          `🤖 Bot: ✅ Online\n` +
          `👑 Admin: @${ADMIN_USERNAME}`;
        await bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
        break;
      }
      
      // ===== ADMIN: ADD USER =====
      case 'adduser':
        if (!isAdmin(username)) return bot.sendMessage(chatId, '❌ Admin only.');
        tgSessions.set(chatId, { step: 'adduser_username', createdAt: Date.now() });
        await bot.sendMessage(chatId, '👤 *Add Web Panel User*\n\nStep 1/2: Enter username:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
        
      case 'removeuser':
        if (!isAdmin(username)) return bot.sendMessage(chatId, '❌ Admin only.');
        tgSessions.set(chatId, { step: 'removeuser_username', createdAt: Date.now() });
        await bot.sendMessage(chatId, '❌ *Remove User*\n\nEnter the username to remove:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
        break;
        
      case 'users':
        if (!isAdmin(username)) return bot.sendMessage(chatId, '❌ Admin only.');
        const users = await readJSON(USERS_FILE);
        if (!users.length) return bot.sendMessage(chatId, '👤 No users yet.');
        const userList = users.map(u => 
          `• *${u.username}* (${u.role})${u.telegramId ? ' ✅ @' + u.telegramId : ' ⚠️ Not linked'}`
        ).join('\n');
        await bot.sendMessage(chatId, `👤 *Registered Users:*\n\n${userList}`, { parse_mode: 'Markdown' });
        break;
        
      // ===== ADMIN: HOSTINGER SMTP MANAGEMENT =====
      case 'addsmtp':
        if (!isAdmin(username)) return bot.sendMessage(chatId, '❌ Admin only.');
        tgSessions.set(chatId, { step: 'smtp_email', createdAt: Date.now() });
        await bot.sendMessage(chatId, 
          `📬 *Add Hostinger SMTP*\n\n` +
          `Server: \`${HOSTINGER_SMTP.host}\`\n` +
          `Port: \`${HOSTINGER_SMTP.port}\` (SSL)\n\n` +
          `Step 1/3: Enter the Hostinger email address:\n\n` +
          `Type /cancel to abort.`, 
          { parse_mode: 'Markdown' }
        );
        break;
        
      case 'listsmtps': {
        if (!isAdmin(username)) return bot.sendMessage(chatId, '❌ Admin only.');
        const smtps = getSharedSmtpConfigs();
        if (!smtps.length) return bot.sendMessage(chatId, '📬 No Hostinger SMTPs configured yet.\n\nUse "Add Hostinger SMTP" to add one.');
        const list = smtps.map((s, i) => 
          `${i + 1}. *${s.name || s.user}*\n` +
          `   📧 \`${s.user}\`\n` +
          `   🌐 Domain: \`${s.domain || 'N/A'}\`\n` +
          `   🆔 ID: \`${s.id}\``
        ).join('\n\n');
        await bot.sendMessage(chatId, `📬 *Hostinger SMTPs:*\n\n${list}`, { parse_mode: 'Markdown' });
        break;
      }
      
      case 'deletesmtp':
        if (!isAdmin(username)) return bot.sendMessage(chatId, '❌ Admin only.');
        const smtpsForDelete = getSharedSmtpConfigs();
        if (!smtpsForDelete.length) return bot.sendMessage(chatId, '📬 No SMTPs to delete.');
        const delList = smtpsForDelete.map((s, i) => `${i + 1}. ${s.name || s.user} - \`${s.id}\``).join('\n');
        tgSessions.set(chatId, { step: 'deletesmtp_id', createdAt: Date.now() });
        await bot.sendMessage(chatId, `🗑️ *Delete SMTP*\n\nAvailable SMTPs:\n${delList}\n\nEnter the SMTP ID to delete:\n\nType /cancel to abort.`, { parse_mode: 'Markdown' });
        break;
    }
  });

  // ===== /start COMMAND =====
  bot.onText(/\/start/, async (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    const user = findUserByChatId(chatId) || findUserByTelegram(username);
    
    let welcomeMsg = `👋 *Welcome to Mailer Bot!*\n\n`;
    
    if (user) {
      welcomeMsg += `✅ You are registered as: *${user.username}*\n\n`;
      welcomeMsg += `🌐 Use the web panel to send emails.\n`;
      welcomeMsg += `📋 Use /credentials to view your login details.`;
    } else {
      welcomeMsg += `❌ You are not registered yet.\n\n`;
      welcomeMsg += `🔗 Use /link to connect your web panel account.\n`;
      welcomeMsg += `📞 Contact @${ADMIN_USERNAME} if you need an account.`;
    }
    
    bot.sendMessage(chatId, welcomeMsg, { 
      parse_mode: 'Markdown',
      ...mainKeyboard(isAdmin(username))
    });
  });

  // ===== /link COMMAND =====
  bot.onText(/\/link/, (msg) => {
    const chatId = msg.chat.id;
    tgSessions.set(chatId, { step: 'link_username', createdAt: Date.now() });
    bot.sendMessage(chatId, '🔗 *Link Telegram to Web Panel*\n\nStep 1/2: Enter your web panel username:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
  });

  // ===== /credentials COMMAND =====
  bot.onText(/\/credentials/, async (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    const user = findUserByChatId(chatId) || findUserByTelegram(username);
    
    if (!user) {
      return bot.sendMessage(chatId, '❌ Your Telegram is not linked to any account.\n\nUse /link to connect your web panel account.');
    }
    
    bot.sendMessage(chatId, 
      `🔐 *Your Web Panel Credentials*\n\n` +
      `👤 Username: \`${user.username}\`\n` +
      `🔑 Password: \`${user.password}\`\n\n` +
      `🌐 *Panel URL:* Your domain\n\n` +
      `⚠️ Keep these credentials secure!`, 
      { parse_mode: 'Markdown' }
    );
  });

  // ===== /menu COMMAND =====
  bot.onText(/\/menu/, (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '📋 *Menu*\n\nChoose an option:', { 
      parse_mode: 'Markdown',
      ...mainKeyboard(isAdmin(username))
    });
  });

  // ===== /cancel COMMAND =====
  bot.onText(/\/cancel/, (msg) => {
    tgSessions.delete(msg.chat.id);
    bot.sendMessage(msg.chat.id, '❌ Operation cancelled.');
  });

  // ===== ADMIN: /adduser COMMAND =====
  bot.onText(/\/adduser/, (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Admin only.');
    tgSessions.set(msg.chat.id, { step: 'adduser_username', createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, '👤 *Add Web Panel User*\n\nStep 1/2: Enter username:\n\nType /cancel to abort.', { parse_mode: 'Markdown' });
  });

  // ===== ADMIN: /addsmtp COMMAND =====
  bot.onText(/\/addsmtp/, (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Admin only.');
    tgSessions.set(msg.chat.id, { step: 'smtp_email', createdAt: Date.now() });
    bot.sendMessage(msg.chat.id, 
      `📬 *Add Hostinger SMTP*\n\n` +
      `Server: \`${HOSTINGER_SMTP.host}\`\n` +
      `Port: \`${HOSTINGER_SMTP.port}\` (SSL)\n\n` +
      `Step 1/3: Enter the Hostinger email address:\n\n` +
      `Type /cancel to abort.`, 
      { parse_mode: 'Markdown' }
    );
  });

  // ===== ADMIN: /smtps COMMAND =====
  bot.onText(/\/smtps/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Admin only.');
    const smtps = getSharedSmtpConfigs();
    if (!smtps.length) return bot.sendMessage(msg.chat.id, '📬 No Hostinger SMTPs configured.\n\nUse /addsmtp to add one.');
    const list = smtps.map((s, i) => 
      `${i + 1}. *${s.name || s.user}*\n` +
      `   📧 \`${s.user}\`\n` +
      `   🌐 Domain: \`${s.domain || 'N/A'}\`\n` +
      `   🆔 ID: \`${s.id}\``
    ).join('\n\n');
    bot.sendMessage(msg.chat.id, `📬 *Hostinger SMTPs:*\n\n${list}`, { parse_mode: 'Markdown' });
  });

  // ===== ADMIN: /users COMMAND =====
  bot.onText(/\/users/, async (msg) => {
    const username = getUserFromMsg(msg);
    if (!isAdmin(username)) return bot.sendMessage(msg.chat.id, '❌ Admin only.');
    const users = await readJSON(USERS_FILE);
    if (!users.length) return bot.sendMessage(msg.chat.id, '👤 No users yet.');
    const list = users.map(u => 
      `• *${u.username}* (${u.role})${u.telegramId ? ' ✅ @' + u.telegramId : ' ⚠️ Not linked'}`
    ).join('\n');
    bot.sendMessage(msg.chat.id, `👤 *Registered Users:*\n\n${list}`, { parse_mode: 'Markdown' });
  });

  // ===== Handle multi-step sessions =====
  bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    const session = tgSessions.get(msg.chat.id);
    if (!session) return;
    
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    // ===== LINK ACCOUNT FLOW =====
    if (session.step === 'link_username') {
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => u.username === text);
      if (!user) return bot.sendMessage(chatId, '❌ User not found. Check your username and try again.');
      tgSessions.set(chatId, { step: 'link_password', username: text, createdAt: Date.now() });
      bot.sendMessage(chatId, `✅ Username found: *${text}*\n\nStep 2/2: Enter your password:`, { parse_mode: 'Markdown' });
    } 
    else if (session.step === 'link_password') {
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => u.username === session.username && u.password === text);
      if (!user) return bot.sendMessage(chatId, '❌ Invalid password. Try again:');
      user.telegramId = username;
      user.telegramChatId = String(chatId);
      await writeJSON(USERS_FILE, users);
      tgSessions.delete(chatId);
      bot.sendMessage(chatId, 
        `✅ *Account Linked Successfully!*\n\n` +
        `👤 Username: *${session.username}*\n` +
        `🌐 You can now use the web panel.\n\n` +
        `Use /credentials to view your login details.`, 
        { parse_mode: 'Markdown' }
      );
    }
    
    // ===== ADD USER FLOW (Admin) =====
    else if (session.step === 'adduser_username') {
      if (!isAdmin(username)) return;
      const users = await readJSON(USERS_FILE);
      if (users.find(u => u.username === text)) {
        return bot.sendMessage(chatId, '❌ User already exists. Try a different username:');
      }
      tgSessions.set(chatId, { step: 'adduser_password', username: text, createdAt: Date.now() });
      bot.sendMessage(chatId, `✅ Username: *${text}*\n\nStep 2/2: Enter password:`, { parse_mode: 'Markdown' });
    }
    else if (session.step === 'adduser_password') {
      if (!isAdmin(username)) return;
      const users = await readJSON(USERS_FILE);
      users.push({ 
        id: Date.now().toString(), 
        username: session.username, 
        password: text, 
        role: 'user', 
        telegramId: '', 
        telegramChatId: '', 
        createdAt: new Date().toISOString() 
      });
      await writeJSON(USERS_FILE, users);
      tgSessions.delete(chatId);
      bot.sendMessage(chatId, 
        `✅ *User Created!*\n\n` +
        `👤 Username: \`${session.username}\`\n` +
        `🔑 Password: \`${text}\`\n\n` +
        `Share these credentials with the user.\n` +
        `They can use /link to connect their Telegram.`, 
        { parse_mode: 'Markdown' }
      );
    }
    
    // ===== REMOVE USER FLOW (Admin) =====
    else if (session.step === 'removeuser_username') {
      if (!isAdmin(username)) return;
      let users = await readJSON(USERS_FILE);
      const user = users.find(u => u.username === text);
      if (!user) return bot.sendMessage(chatId, '❌ User not found. Try again:');
      if (user.role === 'admin') return bot.sendMessage(chatId, '❌ Cannot remove admin user.');
      users = users.filter(u => u.username !== text);
      await writeJSON(USERS_FILE, users);
      tgSessions.delete(chatId);
      bot.sendMessage(chatId, `✅ User *${text}* removed!`, { parse_mode: 'Markdown' });
    }
    
    // ===== ADD HOSTINGER SMTP FLOW (Admin) =====
    else if (session.step === 'smtp_email') {
      if (!isAdmin(username)) return;
      if (!text.includes('@')) return bot.sendMessage(chatId, '❌ Invalid email. Try again:');
      tgSessions.set(chatId, { step: 'smtp_password', email: text, createdAt: Date.now() });
      bot.sendMessage(chatId, `✅ Email: \`${text}\`\n\nStep 2/3: Enter the email password:`, { parse_mode: 'Markdown' });
    }
    else if (session.step === 'smtp_password') {
      if (!isAdmin(username)) return;
      tgSessions.set(chatId, { step: 'smtp_domain', email: session.email, password: text, createdAt: Date.now() });
      bot.sendMessage(chatId, `✅ Password set.\n\nStep 3/3: Enter the domain for this SMTP (e.g. yourdomain.com):`, { parse_mode: 'Markdown' });
    }
    else if (session.step === 'smtp_domain') {
      if (!isAdmin(username)) return;
      const domain = text.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      
      try {
        const config = await addSharedSmtpConfig({
          name: `Hostinger - ${domain}`,
          host: HOSTINGER_SMTP.host,
          port: HOSTINGER_SMTP.port,
          secure: HOSTINGER_SMTP.secure,
          user: session.email,
          pass: session.password,
          domain: domain,
          provider: 'hostinger',
        });
        
        tgSessions.delete(chatId);
        bot.sendMessage(chatId, 
          `✅ *Hostinger SMTP Added!*\n\n` +
          `📧 Email: \`${session.email}\`\n` +
          `🌐 Domain: \`${domain}\`\n` +
          `🆔 ID: \`${config.id}\`\n\n` +
          `This SMTP is now available to all users.\n` +
          `On the panel they can set any From name and email.`, 
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        bot.sendMessage(chatId, `❌ Failed to add SMTP: ${err.message}`);
      }
    }
    
    // ===== DELETE SMTP FLOW (Admin) =====
    else if (session.step === 'deletesmtp_id') {
      if (!isAdmin(username)) return;
      try {
        await deleteSharedSmtpConfig(text);
        tgSessions.delete(chatId);
        bot.sendMessage(chatId, `✅ SMTP \`${text}\` deleted!`, { parse_mode: 'Markdown' });
      } catch (err) {
        bot.sendMessage(chatId, `❌ Failed to delete: ${err.message}`);
      }
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
