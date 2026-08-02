require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fileupload = require('express-fileupload');
const path = require('path');
const { PORT, MAX_BODY_SIZE } = require('./src/config');
const { readJSONSync, SMTP_CONFIGS_FILE, TEMPLATES_FILE, PROXIES_FILE } = require('./src/storage');
const { initTelegramBot, getBot } = require('./src/telegram');
const { loadProxies } = require('./src/smtp');
const { setupErrorHandlers, checkMemory } = require('./src/memory');
const { rateLimit } = require('./src/rateLimit');
const apiRoutes = require('./src/api/routes');

const app = express();

// ============ MIDDLEWARE ============
app.use(cors());
app.use(bodyParser.json({ limit: MAX_BODY_SIZE }));
app.use(bodyParser.urlencoded({ extended: true, limit: MAX_BODY_SIZE }));
app.use(fileupload({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max upload
  createParentPath: true,
}));
app.use(rateLimit);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRoutes);
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ ERROR HANDLERS ============
setupErrorHandlers(app);

// ============ STARTUP ============
async function start() {
  // Load proxies
  await loadProxies();

  // Initialize Telegram bot
  const bot = initTelegramBot();

  // Start server
  const server = app.listen(PORT, () => {
    console.log(`\n🔥 Wxcked Mailer v2 running at http://localhost:${PORT}`);
    console.log(`📧 SMTP Configs: ${readJSONSync(SMTP_CONFIGS_FILE).length} saved`);
    console.log(`📝 Templates: ${readJSONSync(TEMPLATES_FILE).length} saved`);
    console.log(`🤖 Telegram: ${bot ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`🔗 Proxy count: ${readJSONSync(PROXIES_FILE).length}`);
    console.log(`\nOpen http://localhost:${PORT} in your browser\n`);
  });

  // Store server reference for graceful shutdown
  global.__server = server;

  // Initial memory check
  checkMemory();
}

start().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});