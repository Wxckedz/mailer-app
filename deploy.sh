#!/bin/bash
set -euo pipefail

echo "================================================"
echo "  Wxcked Panel — VPS deploy"
echo "================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

echo "Node $(node -v)  npm $(npm -v)  PM2 $(pm2 -v)"

mkdir -p data data/users logs public/assets templates
npm install --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — set HOSTINGER_USER / HOSTINGER_PASS and Telegram token."
fi

pm2 delete mailer-app >/dev/null 2>&1 || true
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "Running. Panel: http://$(hostname -I | awk '{print $1}'):3000"
echo "Login: admin / admin123  — change this after first login."
echo ""
echo "pm2 logs mailer-app"
echo "Optional: copy nginx.conf.example and run certbot."
echo "Optional: pm2 startup   (enable reboot persist)"
echo ""
