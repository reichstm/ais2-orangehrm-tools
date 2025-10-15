#!/bin/bash
# ==============================================
# AIS2-OrangeHRM Tools Deployment Script
# ==============================================

APP_NAME="ais2"
APP_DIR="$HOME/ais2"
GIT_REPO="https://github.com/reichstm/ais2-orangehrm-tools.git"
NODE_ENV="production"

echo "=== AIS2-OrangeHRM Tools Deployment ==="

# Ensure we are NOT root
if [ "$EUID" -eq 0 ]; then
  echo "❌ Please DO NOT run this script as root or with sudo."
  exit 1
fi

# Check for git and pm2
if ! command -v git &> /dev/null; then
  echo "❌ Git is not installed. Please install it first."
  exit 1
fi

if ! command -v pm2 &> /dev/null; then
  echo "⚙️ PM2 not found. Installing globally for user..."
  npm install -g pm2
fi

# Clone or update repository
if [ ! -d "$APP_DIR" ]; then
  echo "📦 Cloning repository into $APP_DIR..."
  git clone "$GIT_REPO" "$APP_DIR"
else
  echo "🔄 Repository exists, pulling latest changes..."
  cd "$APP_DIR" || exit 1
  git reset --hard
  git pull origin main
fi

# Move into app directory
cd "$APP_DIR" || exit 1

# Install dependencies
echo "📥 Installing dependencies..."
npm install --omit=dev

# Start or restart PM2 service
if pm2 list | grep -q "$APP_NAME"; then
  echo "♻️ Restarting existing PM2 service..."
  pm2 restart "$APP_NAME"
else
  echo "🚀 Starting new PM2 service..."
  pm2 start index.js --name "$APP_NAME" --env "$NODE_ENV"
fi

# Enable PM2 autostart for this user
echo "🔐 Setting up PM2 autostart for user $(whoami)..."
pm2 save
pm2 startup systemd -u $(whoami) --hp "$HOME"

echo "✅ Deployment complete!"
pm2 status "$APP_NAME"
