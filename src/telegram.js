const path = require('path');
const { ADMIN_USERNAME, TG_SESSION_TTL_MS, HOSTINGER_SMTP, DATA_DIR } = require('./config');
const {
  readJSON, readJSONSync, writeJSON,
  USERS_FILE
} = require('./storage');
const FEED_FILE = path.join(DATA_DIR, 'telegram-feed.json');
const {
  getSharedSmtpConfigs, addSharedSmtpConfig, deleteSharedSmtpConfig
} = require('./smtp');

let bot = null;
const tgSessions = new Map();

function cleanupTgSessions() {
  const now = Date.now();
  for (const [chatId, session] of tgSessions) {
    if (now - session.createdAt > TG_SESSION_TTL_MS) tgSessions.delete(chatId);
  }
}
setInterval(cleanupTgSessions, 5 * 60 * 1000).unref();

function cleanHandle(s) {
  return String(s || '').toLowerCase().replace(/^@+/, '').trim();
}

function isAdmin(username, chatId) {
  const handle = cleanHandle(username);
  if (handle && handle === ADMIN_USERNAME) return true;
  try {
    const users = readJSONSync(USERS_FILE);
    if (handle && users.some(u => u.role === 'admin' && cleanHandle(u.telegramId) === handle)) return true;
    if (chatId && users.some(u => u.role === 'admin' && String(u.telegramChatId) === String(chatId))) return true;
  } catch (e) {}
  return false;
}

function requireAdminMsg(username, chatId) {
  if (isAdmin(username, chatId)) return true;
  bot.sendMessage(chatId, 'Admin only.');
  return false;
}

function isRegisteredUser(username, chatId) {
  if (!username && !chatId) return false;
  const users = readJSONSync(USERS_FILE);
  if (chatId) {
    const byChat = users.find(u => u.telegramChatId && String(u.telegramChatId) === String(chatId));
    if (byChat) return true;
  }
  if (username) {
    const clean = cleanHandle(username);
    if (clean === ADMIN_USERNAME) return true;
    return users.some(u => u.telegramId && cleanHandle(u.telegramId) === clean);
  }
  return false;
}

function getUserFromMsg(msg) {
  return msg.from?.username || msg.from?.first_name || '';
}

function findUserByTelegram(username) {
  const clean = cleanHandle(username);
  const users = readJSONSync(USERS_FILE);
  return users.find(u => u.telegramId && cleanHandle(u.telegramId) === clean);
}

function findUserByChatId(chatId) {
  const users = readJSONSync(USERS_FILE);
  return users.find(u => u.telegramChatId && String(u.telegramChatId) === String(chatId));
}

function cmdTail(text) {
  return String(text || '').replace(/^\/[A-Za-z0-9_]+(?:@\w+)?\s*/, '').trim();
}

function splitArgs(text) {
  return cmdTail(text).split(/\s+/).filter(Boolean);
}

function mainKeyboard(adminUser) {
  const rows = [
    [{ text: 'Link account', callback_data: 'link' }, { text: 'My login', callback_data: 'credentials' }],
    [{ text: 'Status', callback_data: 'status' }],
  ];
  if (adminUser) {
    rows.push([
      { text: 'Add user', callback_data: 'adduser' },
      { text: 'Remove user', callback_data: 'removeuser' },
    ]);
    rows.push([
      { text: 'Users', callback_data: 'users' },
      { text: 'Reset pass', callback_data: 'setpass' },
    ]);
    rows.push([
      { text: 'Add SMTP', callback_data: 'addsmtp' },
      { text: 'List SMTPs', callback_data: 'listsmtps' },
    ]);
    rows.push([
      { text: 'Delete SMTP', callback_data: 'deletesmtp' },
    ]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

function userListKeyboard(users) {
  const rows = users
    .filter(u => u.role !== 'admin' && cleanHandle(u.username) !== ADMIN_USERNAME)
    .slice(0, 20)
    .map(u => [{ text: 'Remove ' + u.username, callback_data: 'rmu:' + u.username }]);
  rows.push([{ text: 'Close', callback_data: 'menu' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

async function sendTelegramNotification(message, targetChatId) {
  if (!bot) throw new Error('Telegram bot not configured.');
  const chatId = targetChatId || process.env.TELEGRAM_CHAT_ID;
  if (!chatId || chatId === 'YOUR_CHAT_ID')
    throw new Error('Telegram CHAT_ID not configured.');
  return await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeFeedChatId(id) {
  const s = String(id || '').trim();
  if (!s) return '';
  if (/^-?\d+$/.test(s)) return s;
  return s.startsWith('@') ? s : '@' + s.replace(/^@+/, '');
}

function getFeedChatId() {
  const envId = normalizeFeedChatId(process.env.TELEGRAM_FEED_CHAT_ID);
  if (envId) return envId;
  try {
    const saved = readJSONSync(FEED_FILE);
    return saved && saved.chatId ? normalizeFeedChatId(saved.chatId) : '';
  } catch (e) {
    return '';
  }
}

async function setFeedChatId(chatId) {
  await writeJSON(FEED_FILE, { chatId: normalizeFeedChatId(chatId), setAt: new Date().toISOString() });
}

async function notifyAdminFeed(evt) {
  if (!bot) return;
  const chatId = getFeedChatId();
  if (!chatId) return;
  const ok = evt.ok !== false;
  const lines = [
    ok ? '<b>Send · live</b>' : '<b>Send · failed</b>',
    `User: <code>${escHtml(evt.user)}</code>`,
    evt.template ? `Template: ${escHtml(evt.template)}` : '',
    evt.to ? `To: <code>${escHtml(evt.to)}</code>` : '',
    evt.subject ? `Subject: ${escHtml(evt.subject)}` : '',
    evt.from ? `From: ${escHtml(evt.from)}` : '',
    evt.smtp ? `SMTP: ${escHtml(evt.smtp)}` : '',
    evt.error ? `Error: ${escHtml(evt.error)}` : '',
  ].filter(Boolean);
  try {
    await bot.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (e) {}
}

async function handleFeedCmd(msg) {
  const username = getUserFromMsg(msg);
  const chatId = msg.chat.id;
  const raw = (msg.text || '').split(/\s+/)[0].replace(/@\w+$/, '');
  const isChannel = msg.chat.type === 'channel' || msg.chat.type === 'supergroup' || msg.chat.type === 'group';
  if (raw === '/id') {
    try {
      await bot.sendMessage(chatId, `Chat ID: <code>${escHtml(chatId)}</code>\nType: ${escHtml(msg.chat.type)}`, { parse_mode: 'HTML' });
    } catch (e) {}
    return;
  }
  if (!isChannel && !isAdmin(username, chatId)) {
    try { await bot.sendMessage(chatId, 'Admin only.'); } catch (e) {}
    return;
  }
  await setFeedChatId(chatId);
  try {
    await bot.sendMessage(chatId, `Live feed locked to this chat.\nID: <code>${escHtml(chatId)}</code>`, { parse_mode: 'HTML' });
  } catch (e) {}
}

function formatUsers(users) {
  if (!users.length) return 'No panel users yet.';
  return users.map(u => {
    const tg = u.telegramId ? '@' + cleanHandle(u.telegramId) : 'not linked';
    return `• <b>${escHtml(u.username)}</b> · ${escHtml(u.role)} · ${escHtml(tg)}`;
  }).join('\n');
}

async function createPanelUser(username, password, telegramId) {
  const name = String(username || '').trim();
  const pass = String(password || '').trim();
  if (!name || !pass) throw new Error('Username and password required.');
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(name)) throw new Error('Username: 2–32 letters, numbers, . _ -');
  if (pass.length < 4) throw new Error('Password must be at least 4 characters.');
  const users = await readJSON(USERS_FILE);
  if (users.find(u => u.username.toLowerCase() === name.toLowerCase())) {
    throw new Error('User already exists.');
  }
  const row = {
    id: Date.now().toString(),
    username: name,
    password: pass,
    role: 'user',
    telegramId: telegramId ? cleanHandle(telegramId) : '',
    telegramChatId: '',
    createdAt: new Date().toISOString(),
  };
  users.push(row);
  await writeJSON(USERS_FILE, users);
  return row;
}

function canRemoveUser(user) {
  if (!user) return false;
  if (user.role === 'admin') return false;
  if (cleanHandle(user.username) === ADMIN_USERNAME) return false;
  if (cleanHandle(user.telegramId) === ADMIN_USERNAME) return false;
  return true;
}

async function removePanelUser(username) {
  const name = String(username || '').trim();
  const users = await readJSON(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === name.toLowerCase());
  if (!user) throw new Error('User not found.');
  if (!canRemoveUser(user)) throw new Error('Cannot remove admin.');
  await writeJSON(USERS_FILE, users.filter(u => u.id !== user.id));
  return user;
}

async function resetPanelPass(username, password) {
  const name = String(username || '').trim();
  const pass = String(password || '').trim();
  if (pass.length < 4) throw new Error('Password must be at least 4 characters.');
  const users = await readJSON(USERS_FILE);
  const user = users.find(u => u.username.toLowerCase() === name.toLowerCase());
  if (!user) throw new Error('User not found.');
  user.password = pass;
  await writeJSON(USERS_FILE, users);
  return user;
}

async function ensureAdminLinked(username, chatId) {
  if (!isAdmin(username, chatId)) return;
  const handle = cleanHandle(username);
  const users = await readJSON(USERS_FILE);
  let adminUser = users.find(u => cleanHandle(u.telegramId) === handle && u.role === 'admin')
    || users.find(u => u.role === 'admin')
    || users.find(u => u.username === 'admin');
  if (!adminUser) return;
  adminUser.role = 'admin';
  if (handle) adminUser.telegramId = handle;
  adminUser.telegramChatId = String(chatId);
  await writeJSON(USERS_FILE, users);
}

function adminHelp() {
  return [
    '<b>Admin commands</b>',
    '<code>/adduser name pass</code>',
    '<code>/adduser name pass @telegram</code>',
    '<code>/removeuser name</code>',
    '<code>/users</code>',
    '<code>/setpass name newpass</code>',
    '<code>/addsmtp</code>',
    '<code>/smtps</code>',
    '<code>/delsmtp id</code>',
    '<code>/status</code>',
    '<code>/feed</code> · lock live send feed to a chat',
    '',
    'Or tap the menu buttons. /cancel aborts a wizard.',
  ].join('\n');
}

async function sendMenu(chatId, username) {
  const adminUser = isAdmin(username, chatId);
  const title = adminUser ? 'Admin menu' : 'Menu';
  await bot.sendMessage(chatId, title + '\n\n' + (adminUser ? 'Add and remove panel users from here.' : 'Link your panel account to see your login.'), {
    ...mainKeyboard(adminUser),
  });
}

async function sendUserList(chatId) {
  const users = await readJSON(USERS_FILE);
  await bot.sendMessage(chatId, '<b>Panel users</b>\n\n' + formatUsers(users) + '\n\nTap to remove:', {
    parse_mode: 'HTML',
    ...userListKeyboard(users),
  });
}

async function sendStatus(chatId) {
  const users = await readJSON(USERS_FILE);
  const smtps = getSharedSmtpConfigs();
  const feed = getFeedChatId() || 'not set';
  const text = [
    '<b>Status</b>',
    'Server: running',
    `Hostinger SMTPs: ${smtps.length}`,
    `Panel users: ${users.length}`,
    `Bot: online`,
    `Admin: @${escHtml(ADMIN_USERNAME)}`,
    `Feed: ${escHtml(feed)}`,
  ].join('\n');
  await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
}

function setupTelegramBot() {
  if (!bot) return;

  bot.setMyCommands([
    { command: 'start', description: 'Open the bot' },
    { command: 'menu', description: 'Show menu' },
    { command: 'help', description: 'Commands' },
    { command: 'link', description: 'Link panel account' },
    { command: 'credentials', description: 'Show panel login' },
    { command: 'adduser', description: 'Admin: add panel user' },
    { command: 'removeuser', description: 'Admin: remove panel user' },
    { command: 'users', description: 'Admin: list users' },
    { command: 'setpass', description: 'Admin: reset password' },
    { command: 'addsmtp', description: 'Admin: add Hostinger SMTP' },
    { command: 'smtps', description: 'Admin: list SMTPs' },
    { command: 'status', description: 'Status' },
  ]).catch(() => {});

  bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const username = getUserFromMsg(callbackQuery);
    const data = callbackQuery.data || '';
    const chatId = msg.chat.id;
    try { await bot.answerCallbackQuery(callbackQuery.id); } catch (e) {}

    if (data === 'menu') return sendMenu(chatId, username);

    if (data.startsWith('rmu:')) {
      if (!isAdmin(username, chatId)) return bot.sendMessage(chatId, 'Admin only.');
      const name = data.slice(4);
      await bot.sendMessage(chatId, `Remove <code>${escHtml(name)}</code>?`, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: 'Yes, remove', callback_data: 'rmy:' + name },
            { text: 'No', callback_data: 'users' },
          ]],
        },
      });
      return;
    }
    if (data.startsWith('rmy:')) {
      if (!isAdmin(username, chatId)) return bot.sendMessage(chatId, 'Admin only.');
      try {
        const gone = await removePanelUser(data.slice(4));
        await bot.sendMessage(chatId, `Removed <code>${escHtml(gone.username)}</code>.`, { parse_mode: 'HTML' });
        await sendUserList(chatId);
      } catch (err) {
        await bot.sendMessage(chatId, err.message || 'Could not remove.');
      }
      return;
    }

    switch (data) {
      case 'link':
        tgSessions.set(chatId, { step: 'link_username', createdAt: Date.now() });
        await bot.sendMessage(chatId, 'Link Telegram to the panel.\n\nStep 1/2: send the panel username.\n\n/cancel to abort.');
        break;

      case 'credentials': {
        const user = findUserByChatId(chatId) || findUserByTelegram(username);
        if (!user) {
          return bot.sendMessage(chatId, 'Not linked. Use /link.');
        }
        await bot.sendMessage(chatId,
          `<b>Panel login</b>\n\nUser: <code>${escHtml(user.username)}</code>\nPass: <code>${escHtml(user.password)}</code>\n\nhttps://wxcked.wtf`,
          { parse_mode: 'HTML' }
        );
        break;
      }

      case 'status':
        await sendStatus(chatId);
        break;

      case 'adduser':
        if (!isAdmin(username, chatId)) return bot.sendMessage(chatId, 'Admin only.');
        tgSessions.set(chatId, { step: 'adduser_username', createdAt: Date.now() });
        await bot.sendMessage(chatId, 'Add panel user.\n\nStep 1/2: send a username.\n\nOr one line: <code>/adduser name password</code>\n\n/cancel to abort.', { parse_mode: 'HTML' });
        break;

      case 'removeuser':
        if (!isAdmin(username, chatId)) return bot.sendMessage(chatId, 'Admin only.');
        tgSessions.set(chatId, { step: 'removeuser_username', createdAt: Date.now() });
        await bot.sendMessage(chatId, 'Remove user.\n\nSend the username, or <code>/removeuser name</code>.\n\n/cancel to abort.', { parse_mode: 'HTML' });
        break;

      case 'setpass':
        if (!isAdmin(username, chatId)) return bot.sendMessage(chatId, 'Admin only.');
        tgSessions.set(chatId, { step: 'setpass_username', createdAt: Date.now() });
        await bot.sendMessage(chatId, 'Reset password.\n\nStep 1/2: send the username.\n\nOr <code>/setpass name newpass</code>.\n\n/cancel to abort.', { parse_mode: 'HTML' });
        break;

      case 'users':
        if (!isAdmin(username, chatId)) return bot.sendMessage(chatId, 'Admin only.');
        await sendUserList(chatId);
        break;

      case 'addsmtp':
        if (!isAdmin(username, chatId)) return bot.sendMessage(chatId, 'Admin only.');
        tgSessions.set(chatId, { step: 'smtp_email', createdAt: Date.now() });
        await bot.sendMessage(chatId,
          `Add Hostinger SMTP\n\nServer: <code>${escHtml(HOSTINGER_SMTP.host)}</code>\nPort: <code>${escHtml(HOSTINGER_SMTP.port)}</code>\n\nStep 1/3: send the mailbox email.\n\n/cancel to abort.`,
          { parse_mode: 'HTML' }
        );
        break;

      case 'listsmtps': {
        if (!isAdmin(username, chatId)) return bot.sendMessage(chatId, 'Admin only.');
        const smtps = getSharedSmtpConfigs();
        if (!smtps.length) return bot.sendMessage(chatId, 'No Hostinger SMTPs yet. Use Add SMTP.');
        const list = smtps.map((s, i) =>
          `${i + 1}. <b>${escHtml(s.name || s.user)}</b>\n<code>${escHtml(s.user)}</code>\n${escHtml(s.domain || 'n/a')} · <code>${escHtml(s.id)}</code>`
        ).join('\n\n');
        await bot.sendMessage(chatId, '<b>Hostinger SMTPs</b>\n\n' + list, { parse_mode: 'HTML' });
        break;
      }

      case 'deletesmtp': {
        if (!isAdmin(username, chatId)) return bot.sendMessage(chatId, 'Admin only.');
        const smtpsForDelete = getSharedSmtpConfigs();
        if (!smtpsForDelete.length) return bot.sendMessage(chatId, 'No SMTPs to delete.');
        const delList = smtpsForDelete.map((s, i) => `${i + 1}. ${s.name || s.user} — <code>${escHtml(s.id)}</code>`).join('\n');
        tgSessions.set(chatId, { step: 'deletesmtp_id', createdAt: Date.now() });
        await bot.sendMessage(chatId, `Delete SMTP\n\n${delList}\n\nSend the SMTP id.\n\n/cancel to abort.`, { parse_mode: 'HTML' });
        break;
      }
    }
  });

  bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    await ensureAdminLinked(username, chatId);
    const user = findUserByChatId(chatId) || findUserByTelegram(username);
    const adminUser = isAdmin(username, chatId);
    let welcome = 'Wxcked panel bot.\n\n';
    if (adminUser) welcome += 'You are admin. Add and remove users from the menu, or /help.';
    else if (user) welcome += `Linked as ${user.username}. /credentials for login.`;
    else welcome += `Not linked. /link your panel account, or message @${ADMIN_USERNAME}.`;
    await bot.sendMessage(chatId, welcome, mainKeyboard(adminUser));
  });

  bot.onText(/^\/(feed|id)(?:@\w+)?(?:\s|$)/, async (msg) => {
    await handleFeedCmd(msg);
  });
  bot.on('channel_post', async (msg) => {
    const t = msg.text || '';
    if (/^\/(feed|id)/.test(t)) await handleFeedCmd(msg);
  });

  bot.onText(/^\/link(?:@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;
    tgSessions.set(chatId, { step: 'link_username', createdAt: Date.now() });
    bot.sendMessage(chatId, 'Link Telegram to the panel.\n\nStep 1/2: send the panel username.\n\n/cancel to abort.');
  });

  bot.onText(/^\/credentials(?:@\w+)?$/, async (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    const user = findUserByChatId(chatId) || findUserByTelegram(username);
    if (!user) return bot.sendMessage(chatId, 'Not linked. Use /link.');
    bot.sendMessage(chatId,
      `<b>Panel login</b>\n\nUser: <code>${escHtml(user.username)}</code>\nPass: <code>${escHtml(user.password)}</code>\n\nhttps://wxcked.wtf`,
      { parse_mode: 'HTML' }
    );
  });

  bot.onText(/^\/menu(?:@\w+)?$/, (msg) => {
    sendMenu(msg.chat.id, getUserFromMsg(msg));
  });

  bot.onText(/^\/help(?:@\w+)?$/, (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    if (isAdmin(username, chatId)) return bot.sendMessage(chatId, adminHelp(), { parse_mode: 'HTML' });
    bot.sendMessage(chatId, '/start · /menu · /link · /credentials · /help');
  });

  bot.onText(/^\/cancel(?:@\w+)?$/, (msg) => {
    tgSessions.delete(msg.chat.id);
    bot.sendMessage(msg.chat.id, 'Cancelled.');
  });

  bot.onText(/^\/adduser(?:@\w+)?(?:\s|$)/, async (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    if (!requireAdminMsg(username, chatId)) return;
    const args = splitArgs(msg.text);
    if (args.length >= 2) {
      try {
        const row = await createPanelUser(args[0], args[1], args[2]);
        await bot.sendMessage(chatId,
          `<b>User created</b>\n\nUser: <code>${escHtml(row.username)}</code>\nPass: <code>${escHtml(row.password)}</code>${row.telegramId ? '\nTelegram: @' + escHtml(row.telegramId) : ''}\n\nThey /link on this bot.`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        await bot.sendMessage(chatId, err.message || 'Could not add user.');
      }
      return;
    }
    tgSessions.set(chatId, { step: 'adduser_username', createdAt: Date.now() });
    bot.sendMessage(chatId, 'Add panel user.\n\nStep 1/2: send a username.\n\nOr: <code>/adduser name password</code>', { parse_mode: 'HTML' });
  });

  bot.onText(/^\/removeuser(?:@\w+)?(?:\s|$)/, async (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    if (!requireAdminMsg(username, chatId)) return;
    const args = splitArgs(msg.text);
    if (args[0]) {
      try {
        const gone = await removePanelUser(args[0]);
        await bot.sendMessage(chatId, `Removed <code>${escHtml(gone.username)}</code>.`, { parse_mode: 'HTML' });
      } catch (err) {
        await bot.sendMessage(chatId, err.message || 'Could not remove.');
      }
      return;
    }
    tgSessions.set(chatId, { step: 'removeuser_username', createdAt: Date.now() });
    bot.sendMessage(chatId, 'Send the username to remove, or <code>/removeuser name</code>.', { parse_mode: 'HTML' });
  });

  bot.onText(/^\/setpass(?:@\w+)?(?:\s|$)/, async (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    if (!requireAdminMsg(username, chatId)) return;
    const args = splitArgs(msg.text);
    if (args.length >= 2) {
      try {
        const user = await resetPanelPass(args[0], args[1]);
        await bot.sendMessage(chatId, `Password reset for <code>${escHtml(user.username)}</code>\nNew: <code>${escHtml(args[1])}</code>`, { parse_mode: 'HTML' });
      } catch (err) {
        await bot.sendMessage(chatId, err.message || 'Could not reset.');
      }
      return;
    }
    tgSessions.set(chatId, { step: 'setpass_username', createdAt: Date.now() });
    bot.sendMessage(chatId, 'Reset password.\n\nStep 1/2: send the username.\n\nOr: <code>/setpass name newpass</code>', { parse_mode: 'HTML' });
  });

  bot.onText(/^\/addsmtp(?:@\w+)?$/, (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    if (!requireAdminMsg(username, chatId)) return;
    tgSessions.set(chatId, { step: 'smtp_email', createdAt: Date.now() });
    bot.sendMessage(chatId,
      `Add Hostinger SMTP\n\nServer: <code>${escHtml(HOSTINGER_SMTP.host)}</code>\nPort: <code>${escHtml(HOSTINGER_SMTP.port)}</code>\n\nStep 1/3: send the mailbox email.`,
      { parse_mode: 'HTML' }
    );
  });

  bot.onText(/^\/smtps(?:@\w+)?$/, async (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    if (!requireAdminMsg(username, chatId)) return;
    const smtps = getSharedSmtpConfigs();
    if (!smtps.length) return bot.sendMessage(chatId, 'No Hostinger SMTPs. Use /addsmtp.');
    const list = smtps.map((s, i) =>
      `${i + 1}. <b>${escHtml(s.name || s.user)}</b>\n<code>${escHtml(s.user)}</code>\n${escHtml(s.domain || 'n/a')} · <code>${escHtml(s.id)}</code>`
    ).join('\n\n');
    bot.sendMessage(chatId, '<b>Hostinger SMTPs</b>\n\n' + list, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/delsmtp(?:@\w+)?(?:\s|$)/, async (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    if (!requireAdminMsg(username, chatId)) return;
    const id = cmdTail(msg.text);
    if (id) {
      try {
        await deleteSharedSmtpConfig(id);
        await bot.sendMessage(chatId, `SMTP <code>${escHtml(id)}</code> deleted.`, { parse_mode: 'HTML' });
      } catch (err) {
        await bot.sendMessage(chatId, err.message || 'Could not delete.');
      }
      return;
    }
    const smtps = getSharedSmtpConfigs();
    if (!smtps.length) return bot.sendMessage(chatId, 'No SMTPs to delete.');
    const delList = smtps.map((s, i) => `${i + 1}. ${s.name || s.user} — <code>${escHtml(s.id)}</code>`).join('\n');
    tgSessions.set(chatId, { step: 'deletesmtp_id', createdAt: Date.now() });
    bot.sendMessage(chatId, `Send the SMTP id.\n\n${delList}`, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/users(?:@\w+)?$/, async (msg) => {
    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    if (!requireAdminMsg(username, chatId)) return;
    await sendUserList(chatId);
  });

  bot.onText(/^\/status(?:@\w+)?$/, async (msg) => {
    await sendStatus(msg.chat.id);
  });

  bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    const session = tgSessions.get(msg.chat.id);
    if (!session) return;

    const username = getUserFromMsg(msg);
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';
    if (!text) return;

    if (session.step === 'link_username') {
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => u.username === text);
      if (!user) return bot.sendMessage(chatId, 'User not found. Check the username.');
      tgSessions.set(chatId, { step: 'link_password', username: text, createdAt: Date.now() });
      return bot.sendMessage(chatId, `Found ${text}.\n\nStep 2/2: send the password.`);
    }
    if (session.step === 'link_password') {
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => u.username === session.username && u.password === text);
      if (!user) return bot.sendMessage(chatId, 'Wrong password. Try again.');
      user.telegramId = cleanHandle(username);
      user.telegramChatId = String(chatId);
      await writeJSON(USERS_FILE, users);
      tgSessions.delete(chatId);
      return bot.sendMessage(chatId, `Linked as ${session.username}.\n\n/credentials for login.`);
    }

    if (session.step === 'adduser_username') {
      if (!isAdmin(username, chatId)) return;
      const users = await readJSON(USERS_FILE);
      if (users.find(u => u.username.toLowerCase() === text.toLowerCase())) {
        return bot.sendMessage(chatId, 'User already exists. Try another username.');
      }
      tgSessions.set(chatId, { step: 'adduser_password', username: text, createdAt: Date.now() });
      return bot.sendMessage(chatId, `Username: ${text}\n\nStep 2/2: send a password.`);
    }
    if (session.step === 'adduser_password') {
      if (!isAdmin(username, chatId)) return;
      try {
        const row = await createPanelUser(session.username, text);
        tgSessions.delete(chatId);
        return bot.sendMessage(chatId,
          `<b>User created</b>\n\nUser: <code>${escHtml(row.username)}</code>\nPass: <code>${escHtml(row.password)}</code>\n\nShare this. They /link on the bot.`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        return bot.sendMessage(chatId, err.message || 'Could not add user.');
      }
    }

    if (session.step === 'removeuser_username') {
      if (!isAdmin(username, chatId)) return;
      try {
        const gone = await removePanelUser(text);
        tgSessions.delete(chatId);
        return bot.sendMessage(chatId, `Removed <code>${escHtml(gone.username)}</code>.`, { parse_mode: 'HTML' });
      } catch (err) {
        return bot.sendMessage(chatId, err.message || 'Could not remove.');
      }
    }

    if (session.step === 'setpass_username') {
      if (!isAdmin(username, chatId)) return;
      tgSessions.set(chatId, { step: 'setpass_password', username: text, createdAt: Date.now() });
      return bot.sendMessage(chatId, `User: ${text}\n\nStep 2/2: send the new password.`);
    }
    if (session.step === 'setpass_password') {
      if (!isAdmin(username, chatId)) return;
      try {
        const user = await resetPanelPass(session.username, text);
        tgSessions.delete(chatId);
        return bot.sendMessage(chatId, `Password reset for <code>${escHtml(user.username)}</code>\nNew: <code>${escHtml(text)}</code>`, { parse_mode: 'HTML' });
      } catch (err) {
        return bot.sendMessage(chatId, err.message || 'Could not reset.');
      }
    }

    if (session.step === 'smtp_email') {
      if (!isAdmin(username, chatId)) return;
      if (!text.includes('@')) return bot.sendMessage(chatId, 'That is not an email. Try again.');
      tgSessions.set(chatId, { step: 'smtp_password', email: text, createdAt: Date.now() });
      return bot.sendMessage(chatId, `Email: ${text}\n\nStep 2/3: send the mailbox password.`);
    }
    if (session.step === 'smtp_password') {
      if (!isAdmin(username, chatId)) return;
      tgSessions.set(chatId, { step: 'smtp_domain', email: session.email, password: text, createdAt: Date.now() });
      return bot.sendMessage(chatId, 'Password set.\n\nStep 3/3: send the domain (example.com).');
    }
    if (session.step === 'smtp_domain') {
      if (!isAdmin(username, chatId)) return;
      const domain = text.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
      try {
        const config = await addSharedSmtpConfig({
          name: `Hostinger - ${domain}`,
          host: HOSTINGER_SMTP.host,
          port: HOSTINGER_SMTP.port,
          secure: HOSTINGER_SMTP.secure,
          user: session.email,
          pass: session.password,
          domain,
          provider: 'hostinger',
        });
        tgSessions.delete(chatId);
        return bot.sendMessage(chatId,
          `<b>SMTP added</b>\n\n<code>${escHtml(session.email)}</code>\n${escHtml(domain)}\nID: <code>${escHtml(config.id)}</code>\n\nAll panel users can send with it.`,
          { parse_mode: 'HTML' }
        );
      } catch (err) {
        return bot.sendMessage(chatId, 'Failed to add SMTP: ' + (err.message || 'error'));
      }
    }

    if (session.step === 'deletesmtp_id') {
      if (!isAdmin(username, chatId)) return;
      try {
        await deleteSharedSmtpConfig(text);
        tgSessions.delete(chatId);
        return bot.sendMessage(chatId, `SMTP <code>${escHtml(text)}</code> deleted.`, { parse_mode: 'HTML' });
      } catch (err) {
        return bot.sendMessage(chatId, err.message || 'Could not delete.');
      }
    }
  });
}

function initTelegramBot() {
  try {
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN') {
      const TelegramBot = require('node-telegram-bot-api');
      bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
      bot.on('polling_error', (err) => {
        console.log('Telegram poll:', err && err.message ? err.message : err);
      });
      console.log('Telegram bot initialized');
      setupTelegramBot();
    }
  } catch (err) {
    console.log('Telegram bot not configured.');
  }
  return bot;
}

module.exports = {
  initTelegramBot, sendTelegramNotification, notifyAdminFeed, getBot: () => bot
};
