const nodemailer = require('nodemailer');
const { SocksProxyAgent } = require('socks-proxy-agent');
const fs = require('fs-extra');
const { SHARED_SMTP_DOMAINS, SHARED_SMTP_FILE } = require('./config');
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

// ============ SHARED SMTP CONFIGS (dynamic, admin-managed) ============
let sharedSmtpCache = null;

async function loadSharedSmtpConfigs() {
  try {
    const data = await readJSON(SHARED_SMTP_FILE);
    sharedSmtpCache = (data || []).map(c => ({ ...c, isShared: true }));
  } catch {
    sharedSmtpCache = SHARED_SMTP_DOMAINS.map(c => ({ ...c, isShared: true }));
  }
  return sharedSmtpCache;
}

function getSharedSmtpConfigs() {
  if (sharedSmtpCache && sharedSmtpCache.length > 0) return sharedSmtpCache;
  // Fallback to static config if cache not loaded yet
  return SHARED_SMTP_DOMAINS.map(c => ({ ...c, isShared: true }));
}

async function addSharedSmtpConfig(config) {
  const configs = getSharedSmtpConfigs();
  const newConfig = {
    id: config.id || ('shared_' + Date.now().toString()),
    name: config.name,
    host: config.host,
    port: parseInt(config.port) || 587,
    secure: config.secure || false,
    user: config.user,
    pass: config.pass || '',
    domain: config.domain,
    spoofName: config.spoofName || '',
    spoofEmail: config.spoofEmail || '',
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
  // Default domain: first shared domain, or 'irnna.com' fallback
  const defaultDomain = sharedConfigs.length > 0 ? sharedConfigs[0].domain : 'irnna.com';
  const domain = user?.senderDomain || defaultDomain;
  const prefix = user?.senderPrefix || 'noreply';
  return {
    domain,
    prefix,
    hasCustomSmtp: userConfigs.length > 0,
    senderEmail: `${prefix}@${domain}`,
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

async function getEffectiveSmtpConfig(userId, smtpConfigFromReq) {
  let smtpConf = smtpConfigFromReq || {};
  const senderConfig = await getUserSenderConfig(userId);
  const sharedConfigs = getSharedSmtpConfigs();

  if (smtpConf.id) {
    const found = await getSmtpConfigById(userId, smtpConf.id);
    if (found) {
      smtpConf = { ...found };
      // If it's a shared config, apply default sender: noreply@domain
      if (found.isShared) {
        smtpConf.spoofEmail = `noreply@${found.domain}`;
      }
    }
  } else {
    // No config selected — use custom SMTP if available, otherwise shared domain
    const userConfigs = await readUserData(userId, 'smtp-configs');
    if (userConfigs.length > 0) {
      smtpConf = userConfigs[0];
    } else {
      const shared = sharedConfigs.find(s => s.domain === senderConfig.domain);
      if (shared) {
        // Default sender: noreply@domain (unless user has custom prefix)
        smtpConf = { ...shared, spoofEmail: senderConfig.senderEmail };
      } else if (sharedConfigs.length > 0) {
        // Fallback to first shared config
        smtpConf = { ...sharedConfigs[0], spoofEmail: `noreply@${sharedConfigs[0].domain}` };
      }
    }
  }
  
  // Apply user's spoof settings (spoofed email, sender name, profile pic)
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

function createTransportWithProxy(smtpConfig) {
  const proxy = getNextProxy();
  const transportOpts = {
    host: smtpConfig.host || process.env.SMTP_HOST,
    port: parseInt(smtpConfig.port) || parseInt(process.env.SMTP_PORT) || 587,
    secure: smtpConfig.secure === true || smtpConfig.secure === 'true' || process.env.SMTP_SECURE === 'true',
    auth: {
      user: smtpConfig.user || process.env.SMTP_USER,
      pass: smtpConfig.pass || process.env.SMTP_PASS,
    },
    // Connection pooling to reduce overhead
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    rateDelta: 1000,
    rateLimit: 5,
  };
  if (proxy && proxy.enabled !== false) {
    const proxyUrl = `${proxy.type || 'socks5'}://${proxy.host}:${proxy.port}`;
    const agent = new SocksProxyAgent(proxyUrl);
    transportOpts.socksProxy = agent;
  }
  return nodemailer.createTransport(transportOpts);
}

function createTransporter(config) {
  return createTransportWithProxy(config);
}

/**
 * Attach a sender image (profile picture / avatar) to outgoing email mail options.
 * The image is embedded as an inline attachment referenced by Content-ID
 * `sender-image@wxcked` and injected at the top of the HTML body.
 *
 * @param {object} mailOptions - nodemailer mail options
 * @param {string} [profilePicPath] - file path to a saved profile picture
 * @param {string} [base64Image] - base64 data URL string (e.g. "data:image/jpeg;base64,...")
 * @returns {object} the (mutated) mailOptions
 */
function attachSenderImage(mailOptions, profilePicPath, base64Image) {
  let attachment = null;

  if (base64Image) {
    // base64Image may be a full data URL or raw base64
    const dataUrlMatch = base64Image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (dataUrlMatch) {
      const ext = dataUrlMatch[1].split('/')[1];
      attachment = {
        filename: `sender-image.${ext}`,
        content: Buffer.from(dataUrlMatch[2], 'base64'),
        cid: 'sender-image@wxcked',
        contentType: dataUrlMatch[1],
      };
    } else {
      // Assume raw base64 with a default extension
      attachment = {
        filename: 'sender-image.jpg',
        content: Buffer.from(base64Image, 'base64'),
        cid: 'sender-image@wxcked',
        contentType: 'image/jpeg',
      };
    }
  } else if (profilePicPath) {
    try {
      if (fs.existsSync(profilePicPath)) {
        attachment = {
          filename: 'sender-image.jpg',
          path: profilePicPath,
          cid: 'sender-image@wxcked',
        };
      }
    } catch (e) {
      // ignore file errors
    }
  }

  if (attachment) {
    mailOptions.attachments = mailOptions.attachments || [];
    mailOptions.attachments.push(attachment);
    // Inject the avatar at the top of the HTML body so it renders inline
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

module.exports = {
  loadProxies, getNextProxy, getSharedSmtpConfigs,
  loadSharedSmtpConfigs, addSharedSmtpConfig, deleteSharedSmtpConfig,
  getAllSmtpConfigs, getUserSenderConfig, getSmtpConfigById,
  getEffectiveSmtpConfig, getBotSmtpConfig,
  createTransporter, createTransportWithProxy,
  attachSenderImage
};
