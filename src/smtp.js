const nodemailer = require('nodemailer');
const { SocksProxyAgent } = require('socks-proxy-agent');
const fs = require('fs-extra');
const path = require('path');
const { HOSTINGER_SMTP, SHARED_SMTP_FILE, DATA_DIR } = require('./config');
const { readJSON, writeJSON, readUserData, PROXIES_FILE, USERS_FILE } = require('./storage');

// ============ PROXY ROTATION ============
let proxyList = [];
let proxyIndex = 0;

async function loadProxies() {
  try {
    proxyList = await readJSON(PROXIES_FILE) || [];
  } catch {
    proxyList = [];
  }
}

function getNextProxy() {
  if (proxyList.length === 0) return null;
  const p = proxyList[proxyIndex % proxyList.length];
  proxyIndex++;
  return p;
}

// ============ SHARED SMTP CONFIGS (Hostinger SMTPs, admin-managed) ============
let sharedSmtpCache = null;

async function loadSharedSmtpConfigs() {
  try {
    const data = await readJSON(SHARED_SMTP_FILE);
    sharedSmtpCache = (data || []).map(c => ({
      ...c,
      isShared: true,
      provider: c.provider || detectProvider(c),
    }));
  } catch {
    sharedSmtpCache = [];
  }
  await ensureHostingerFromEnv();
  return sharedSmtpCache;
}

async function ensureHostingerFromEnv() {
  const user = String(process.env.HOSTINGER_USER || '').trim();
  const pass = String(process.env.HOSTINGER_PASS || '').trim();
  if (!user || !pass) return;
  const domain = String(process.env.HOSTINGER_DOMAIN || (user.includes('@') ? user.split('@')[1] : '')).trim();
  const configs = getSharedSmtpConfigs();
  const existing = configs.find(c =>
    String(c.user || '').toLowerCase() === user.toLowerCase() &&
    (c.provider === 'hostinger' || String(c.host || '').toLowerCase().includes('hostinger'))
  );
  if (existing) {
    existing.pass = pass;
    existing.domain = domain || existing.domain;
    existing.host = HOSTINGER_SMTP.host;
    existing.port = HOSTINGER_SMTP.port;
    existing.secure = HOSTINGER_SMTP.secure;
    existing.provider = 'hostinger';
    existing.isShared = true;
    sharedSmtpCache = configs;
    await writeJSON(SHARED_SMTP_FILE, configs);
    return existing;
  }
  return addSharedSmtpConfig({
    id: 'hostinger_' + (domain || 'mail').replace(/[^a-z0-9]/gi, ''),
    name: `Hostinger - ${domain || user}`,
    host: HOSTINGER_SMTP.host,
    port: HOSTINGER_SMTP.port,
    secure: HOSTINGER_SMTP.secure,
    user,
    pass,
    domain,
    provider: 'hostinger',
  });
}

function getSharedSmtpConfigs() {
  if (sharedSmtpCache !== null) return sharedSmtpCache;
  return [];
}

function detectProvider(config) {
  if (config?.provider) return config.provider;
  const host = String(config?.host || '').toLowerCase();
  if (host.includes('hostinger')) return 'hostinger';
  if (host.includes('resend')) return 'resend';
  if (host.includes('sendgrid')) return 'sendgrid';
  return 'custom';
}

function isHostingerSmtp(smtpConf) {
  if (!smtpConf) return false;
  if (smtpConf.provider === 'hostinger') return true;
  return String(smtpConf.host || '').toLowerCase().includes('hostinger');
}

async function addSharedSmtpConfig(config) {
  const configs = getSharedSmtpConfigs();
  const host = config.host || HOSTINGER_SMTP.host;
  const provider = detectProvider({ ...config, host });
  const newConfig = {
    id: config.id || (`${provider}_` + Date.now().toString()),
    name: config.name || `${provider === 'hostinger' ? 'Hostinger' : 'SMTP'} - ${config.domain || host}`,
    host,
    port: parseInt(config.port) || (provider === 'hostinger' ? HOSTINGER_SMTP.port : 465),
    secure: config.secure !== undefined ? config.secure : (provider === 'hostinger' ? HOSTINGER_SMTP.secure : true),
    user: config.user,
    pass: config.pass || '',
    domain: config.domain,
    spoofName: config.spoofName || '',
    spoofEmail: config.spoofEmail || '',
    provider,
    isShared: true,
    createdAt: new Date().toISOString()
  };
  const idx = configs.findIndex(c => c.id === newConfig.id);
  if (idx >= 0) {
    if (newConfig.pass === '********') newConfig.pass = configs[idx].pass;
    configs[idx] = newConfig;
  } else {
    configs.push(newConfig);
  }
  sharedSmtpCache = configs;
  await writeJSON(SHARED_SMTP_FILE, configs);
  return newConfig;
}

async function deleteSharedSmtpConfig(id) {
  let configs = getSharedSmtpConfigs();
  configs = configs.filter(c => c.id !== id);
  sharedSmtpCache = configs;
  await writeJSON(SHARED_SMTP_FILE, configs);
  return configs;
}

async function getAllSmtpConfigs(userId) {
  const userConfigs = await readUserData(userId, 'smtp-configs');
  return [...getSharedSmtpConfigs(), ...userConfigs];
}

async function getUserSenderConfig(userId) {
  const users = await readJSON(USERS_FILE);
  const user = users.find(u => String(u.id) === String(userId));
  const userConfigs = await readUserData(userId, 'smtp-configs');
  const sharedConfigs = getSharedSmtpConfigs();
  
  // Default domain: first shared domain, or empty
  const defaultDomain = sharedConfigs.length > 0 ? sharedConfigs[0].domain : '';
  const domain = user?.senderDomain || defaultDomain;
  const prefix = user?.senderPrefix || 'noreply';
  
  return {
    domain,
    prefix,
    hasCustomSmtp: userConfigs.length > 0,
    senderEmail: domain ? `${prefix}@${domain}` : '',
    senderName: user?.senderName || '',
    profilePic: user?.profilePic || '',
    spoofEmail: user?.spoofEmail || ''
  };
}

async function getSmtpConfigById(userId, configId) {
  let found = getSharedSmtpConfigs().find(c => c.id === configId);
  if (found) return found;
  const userConfigs = await readUserData(userId, 'smtp-configs');
  found = userConfigs.find(c => c.id === configId);
  return found;
}

function sanitizePrefix(prefix) {
  return String(prefix || '').trim().toLowerCase().replace(/[^a-z0-9._+-]/g, '');
}

function smtpDomain(smtpConf) {
  if (!smtpConf) return '';
  if (smtpConf.domain) return smtpConf.domain;
  if (smtpConf.user && String(smtpConf.user).includes('@')) return String(smtpConf.user).split('@').pop();
  return '';
}

function isPrefixSmtp(smtpConf) {
  if (!smtpConf) return false;
  if (isHostingerSmtp(smtpConf)) return false;
  if (smtpConf.provider === 'resend' || smtpConf.provider === 'sendgrid') return true;
  const host = String(smtpConf.host || '').toLowerCase();
  return host.includes('resend.com') || host.includes('sendgrid.net');
}

function resolveSpoofEmail(raw, smtpConf) {
  const value = String(raw || '').trim();
  // Hostinger / custom: From name + From email are free, like the Telegram bot
  if (!isPrefixSmtp(smtpConf)) {
    return value || smtpConf?.spoofEmail || smtpConf?.user || '';
  }
  const domain = smtpDomain(smtpConf);
  if (!value) {
    if (smtpConf?.spoofEmail && String(smtpConf.spoofEmail).includes('@') && domain && smtpConf.spoofEmail.endsWith('@' + domain)) {
      return smtpConf.spoofEmail;
    }
    if (domain) return `noreply@${domain}`;
    return smtpConf?.user || '';
  }
  if (value.includes('@')) {
    if (domain && !value.toLowerCase().endsWith('@' + domain.toLowerCase())) {
      const prefix = sanitizePrefix(value.split('@')[0]) || 'noreply';
      return `${prefix}@${domain}`;
    }
    return value;
  }
  const prefix = sanitizePrefix(value) || 'noreply';
  return domain ? `${prefix}@${domain}` : prefix;
}

function applyFromHeaders(smtpConf, mailOptions) {
  if (isHostingerSmtp(smtpConf) && smtpConf.user) {
    mailOptions.sender = smtpConf.user;
    mailOptions.replyTo = mailOptions.replyTo || mailOptions.from;
    mailOptions.envelope = {
      from: smtpConf.user,
      to: mailOptions.to,
    };
  }
  return mailOptions;
}

async function getEffectiveSmtpConfig(userId, smtpConfigFromReq) {
  let smtpConf = smtpConfigFromReq || {};
  const senderConfig = await getUserSenderConfig(userId);
  const sharedConfigs = getSharedSmtpConfigs();

  if (smtpConf.id) {
    const found = await getSmtpConfigById(userId, smtpConf.id);
    if (found) {
      smtpConf = { ...found };
      if (found.isShared) {
        smtpConf.spoofEmail = smtpConf.spoofEmail || `noreply@${found.domain}`;
      }
    }
  } else {
    // No config selected — use custom SMTP if available, otherwise shared
    const userConfigs = await readUserData(userId, 'smtp-configs');
    if (userConfigs.length > 0) {
      smtpConf = userConfigs[0];
    } else if (sharedConfigs.length > 0) {
      const shared = sharedConfigs.find(s => s.domain === senderConfig.domain) || sharedConfigs[0];
      smtpConf = { ...shared, spoofEmail: senderConfig.senderEmail || `noreply@${shared.domain}` };
    }
  }
  
  if (senderConfig.senderName) {
    smtpConf.spoofName = senderConfig.senderName;
  }
  if (senderConfig.profilePic) {
    smtpConf.profilePic = senderConfig.profilePic;
  }

  if (isPrefixSmtp(smtpConf)) {
    smtpConf.spoofEmail = resolveSpoofEmail(
      smtpConf.spoofEmail || senderConfig.senderEmail,
      smtpConf
    );
  } else if (senderConfig.spoofEmail) {
    smtpConf.spoofEmail = senderConfig.spoofEmail;
  }
  
  return smtpConf;
}

async function getBotSmtpConfig(user) {
  const sharedConfigs = getSharedSmtpConfigs();
  if (!user) {
    const shared = sharedConfigs[0];
    return shared ? { ...shared, spoofEmail: 'noreply@' + shared.domain } : {};
  }
  const userConfigs = await readUserData(user.id, 'smtp-configs');
  let smtpConf;
  if (userConfigs.length > 0) {
    smtpConf = userConfigs[0];
  } else {
    const senderConfig = await getUserSenderConfig(user.id);
    const shared = sharedConfigs.find(s => s.domain === senderConfig.domain);
    if (shared) {
      smtpConf = { ...shared, spoofEmail: senderConfig.senderEmail };
    } else if (sharedConfigs.length > 0) {
      smtpConf = { ...sharedConfigs[0], spoofEmail: `noreply@${sharedConfigs[0].domain}` };
    } else {
      smtpConf = {};
    }
  }
  
  // Apply user's spoof settings
  const senderConfig = await getUserSenderConfig(user.id);
  if (senderConfig.spoofEmail) {
    smtpConf.spoofEmail = senderConfig.spoofEmail;
  }
  if (senderConfig.senderName) {
    smtpConf.spoofName = senderConfig.senderName;
  }
  if (senderConfig.profilePic) {
    smtpConf.profilePic = senderConfig.profilePic;
  }
  
  return smtpConf;
}

/**
 * Create nodemailer transport for Hostinger SMTP
 * Hostinger uses:
 * - Host: smtp.hostinger.com
 * - Port 587 with STARTTLS or Port 465 with SSL
 */
function createTransporter(smtpConfig) {
  const proxy = getNextProxy();
  
  const isSSL = smtpConfig.port === 465 || smtpConfig.secure === true;
  
  const transportOpts = {
    host: smtpConfig.host || HOSTINGER_SMTP.host,
    port: parseInt(smtpConfig.port) || HOSTINGER_SMTP.port,
    secure: isSSL, // true for 465, false for 587
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass,
    },
    // TLS options for STARTTLS (port 587)
    tls: {
      rejectUnauthorized: false,
      ciphers: 'SSLv3',
    },
    // Connection settings
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
  };
  
  if (proxy && proxy.enabled !== false) {
    const proxyUrl = `${proxy.type || 'socks5'}://${proxy.host}:${proxy.port}`;
    const agent = new SocksProxyAgent(proxyUrl);
    transportOpts.socksProxy = agent;
  }
  
  return nodemailer.createTransport(transportOpts);
}

/**
 * Send email with proper headers for spoofing
 * @param {object} smtpConfig - SMTP configuration
 * @param {object} mailOptions - Email options (to, subject, html, text, etc.)
 * @param {object} spoofOptions - Spoofing options (fromName, fromEmail, replyTo)
 */
async function sendEmail(smtpConfig, mailOptions, spoofOptions = {}) {
  const transporter = createTransporter(smtpConfig);
  
  const fromName = spoofOptions.fromName || smtpConfig.spoofName || '';
  const fromEmail = spoofOptions.fromEmail || smtpConfig.spoofEmail || smtpConfig.user;
  const replyTo = spoofOptions.replyTo || fromEmail;
  
  const finalMailOptions = attachCidImages(applyFromHeaders(smtpConfig, {
    ...mailOptions,
    from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
    replyTo,
  }));
  
  return await transporter.sendMail(finalMailOptions);
}

/**
 * Process HTML template with variables
 * Variables use format: {{VARIABLE_NAME}}
 */
function processTemplate(html, variables = {}) {
  let processed = html;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    processed = processed.replace(regex, value || '');
  }
  return processed;
}

/**
 * Attach a sender image (profile picture / avatar) to outgoing email mail options.
 */
function attachSenderImage(mailOptions, profilePicPath, base64Image) {
  let attachment = null;

  if (base64Image) {
    const dataUrlMatch = base64Image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (dataUrlMatch) {
      const ext = dataUrlMatch[1].split('/')[1];
      attachment = {
        filename: `logo.${ext === 'jpeg' ? 'jpg' : ext}`,
        content: Buffer.from(dataUrlMatch[2], 'base64'),
        cid: 'sender-image@wxcked',
        contentType: dataUrlMatch[1],
        contentDisposition: 'inline',
      };
    } else {
      attachment = {
        filename: 'logo.jpg',
        content: Buffer.from(base64Image, 'base64'),
        cid: 'sender-image@wxcked',
        contentType: 'image/jpeg',
        contentDisposition: 'inline',
      };
    }
  } else if (profilePicPath) {
    try {
      if (fs.existsSync(profilePicPath)) {
        attachment = {
          filename: 'logo.jpg',
          path: profilePicPath,
          cid: 'sender-image@wxcked',
          contentType: 'image/jpeg',
          contentDisposition: 'inline',
        };
      }
    } catch (e) {
      // ignore file errors
    }
  }

  if (attachment) {
    mailOptions.attachments = mailOptions.attachments || [];
    mailOptions.attachments.push(attachment);
    if (mailOptions.html) {
      const avatarHtml =
        '<div style="text-align:center;margin-bottom:20px;">' +
        '<img src="cid:sender-image@wxcked" ' +
        'style="width:80px;height:80px;border-radius:50%;object-fit:cover;' +
        'border:1px solid rgba(0,0,0,0.1);display:block;margin:0 auto;" alt="Sender" />' +
        '</div>';
      mailOptions.html = avatarHtml + mailOptions.html;
    }
  }

  return mailOptions;
}

const CID_DIRS = [
  path.join(__dirname, '..', 'templates'),
  path.join(__dirname, '..', 'public', 'assets'),
];
const CID_ALIASES = {
  metlogo: ['m.jpg', 'metlogo.jpg', 'm'],
  metlogo2: ['m.jpg', 'metlogo.jpg', 'm'],
  nypdlogo: ['nypd.png', 'nypdlogo.png', 'nypd'],
  fcalogo: ['fca.png', 'fca'],
};

function mimeForImage(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/jpeg';
}

function listImageFiles() {
  const files = [];
  for (const dir of CID_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(png|jpe?g|gif|webp)$/i.test(name)) continue;
      files.push(path.join(dir, name));
    }
  }
  return files;
}

function resolveCidFile(cid) {
  const key = String(cid || '').split('@')[0].toLowerCase();
  if (!key) return '';
  const byBase = new Map();
  for (const file of listImageFiles()) {
    const base = path.basename(file).toLowerCase();
    const stem = base.replace(/\.[^.]+$/, '');
    if (!byBase.has(base)) byBase.set(base, file);
    if (!byBase.has(stem)) byBase.set(stem, file);
  }
  if (byBase.has(key)) return byBase.get(key);
  for (const alias of (CID_ALIASES[key] || [])) {
    const hit = byBase.get(String(alias).toLowerCase());
    if (hit) return hit;
  }
  return '';
}

function inlinePart(part) {
  if (!part) return part;
  const image = /image\//i.test(part.contentType || '')
    || /\.(png|jpe?g|gif|webp)$/i.test(part.filename || '')
    || !!part.cid;
  if (!image) return part;
  return { ...part, contentDisposition: 'inline' };
}

function attachCidImages(mailOptions) {
  try {
    let html = String(mailOptions.html || '');
    const found = [...html.matchAll(/cid:([a-zA-Z0-9._@-]+)/g)].map(m => m[1]);
    mailOptions.attachments = (mailOptions.attachments || []).map(inlinePart);
    if (!found.length) return mailOptions;
    const used = new Set(mailOptions.attachments.map(a => a && a.cid).filter(Boolean));
    for (const raw of found) {
      const bare = String(raw).split('@')[0];
      const file = resolveCidFile(bare);
      const inlineCid = bare.includes('@') ? raw : bare + '@wxcked';
      if (raw !== inlineCid) html = html.split('cid:' + raw).join('cid:' + inlineCid);
      if (!file) continue;
      if (used.has(inlineCid) || used.has(raw) || used.has(bare)) continue;
      const ext = path.extname(file) || '.png';
      mailOptions.attachments.push({
        filename: bare + ext,
        path: file,
        cid: inlineCid,
        contentType: mimeForImage(file),
        contentDisposition: 'inline',
        headers: {
          'Content-ID': `<${inlineCid}>`,
          'X-Attachment-Id': inlineCid,
        },
      });
      used.add(inlineCid);
    }
    mailOptions.html = html;
    return mailOptions;
  } catch (e) {
    return mailOptions;
  }
}

module.exports = {
  loadProxies, getNextProxy, getSharedSmtpConfigs,
  loadSharedSmtpConfigs, addSharedSmtpConfig, deleteSharedSmtpConfig,
  ensureHostingerFromEnv,
  getAllSmtpConfigs, getUserSenderConfig, getSmtpConfigById,
  getEffectiveSmtpConfig, getBotSmtpConfig,
  createTransporter, sendEmail, processTemplate,
  attachSenderImage, attachCidImages, HOSTINGER_SMTP,
  resolveSpoofEmail, isPrefixSmtp, isHostingerSmtp, smtpDomain, sanitizePrefix,
  applyFromHeaders, detectProvider
};
