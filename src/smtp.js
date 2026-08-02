const nodemailer = require('nodemailer');
const { SocksProxyAgent } = require('socks-proxy-agent');
const fs = require('fs-extra');
const { SHARED_SMTP_DOMAINS } = require('./config');
const { readJSON, readUserData, PROXIES_FILE, USERS_FILE } = require('./storage');

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

function getSharedSmtpConfigs() {
  return SHARED_SMTP_DOMAINS;
}

async function getAllSmtpConfigs(userId) {
  const userConfigs = await readUserData(userId, 'smtp-configs');
  return [...SHARED_SMTP_DOMAINS, ...userConfigs];
}

async function getUserSenderConfig(userId) {
  const users = await readJSON(USERS_FILE);
  const user = users.find(u => String(u.id) === String(userId));
  const userConfigs = await readUserData(userId, 'smtp-configs');
  const domain = user?.senderDomain || 'irnna.com';
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
  let found = SHARED_SMTP_DOMAINS.find(c => c.id === configId);
  if (found) return found;
  const userConfigs = await readUserData(userId, 'smtp-configs');
  found = userConfigs.find(c => c.id === configId);
  return found;
}

async function getEffectiveSmtpConfig(userId, smtpConfigFromReq) {
  let smtpConf = smtpConfigFromReq || {};
  const senderConfig = await getUserSenderConfig(userId);

  if (smtpConf.id) {
    const found = await getSmtpConfigById(userId, smtpConf.id);
    if (found) {
      smtpConf = { ...found };
      // If it's a shared config, apply user's prefix as spoofEmail
      if (found.isShared) {
        smtpConf.spoofEmail = `${senderConfig.prefix}@${found.domain}`;
      }
    }
  } else {
    // No config selected — use custom SMTP if available, otherwise shared domain
    const userConfigs = await readUserData(userId, 'smtp-configs');
    if (userConfigs.length > 0) {
      smtpConf = userConfigs[0];
    } else {
      const shared = SHARED_SMTP_DOMAINS.find(s => s.domain === senderConfig.domain);
      if (shared) {
        smtpConf = { ...shared, spoofEmail: senderConfig.senderEmail };
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
  if (!user) {
    const shared = SHARED_SMTP_DOMAINS[0];
    return shared ? { ...shared, spoofEmail: 'noreply@' + shared.domain } : {};
  }
  const userConfigs = await readUserData(user.id, 'smtp-configs');
  let smtpConf;
  if (userConfigs.length > 0) {
    smtpConf = userConfigs[0];
  } else {
    const senderConfig = await getUserSenderConfig(user.id);
    const shared = SHARED_SMTP_DOMAINS.find(s => s.domain === senderConfig.domain);
    if (shared) {
      smtpConf = { ...shared, spoofEmail: senderConfig.senderEmail };
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
  getAllSmtpConfigs, getUserSenderConfig, getSmtpConfigById,
  getEffectiveSmtpConfig, getBotSmtpConfig,
  createTransporter, createTransportWithProxy,
  attachSenderImage
};
