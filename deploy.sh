#!/bin/bash

# openletterhk.org deployment
# Pulls the public repo on the server and reloads the PM2 process.
# Signatures live in /var/www/openletterhk.org/data (gitignored) and survive deploys.
#
# Usage:
#   ./deploy.sh

set -e

SERVER="root@5.223.89.26"
ROOT="/var/www/openletterhk.org"
REPO="https://github.com/ilyabelikin/openletterhk.org.git"
NODE_BIN="/root/.nvm/versions/node/v22.12.0/bin"
PM2="$NODE_BIN/pm2"
PORT=3010

echo "🚀 Deploying to $SERVER..."

ssh "$SERVER" "bash -s" <<ENDSSH
set -e
# pm2 is a script with a #!/usr/bin/env node shebang; a non-interactive shell has no nvm on PATH.
export PATH="$NODE_BIN:\$PATH"

if [ ! -d "$ROOT/.git" ]; then
  echo "📥 Cloning repository for the first time..."
  mkdir -p /var/www
  git clone "$REPO" "$ROOT"
fi

cd "$ROOT"
echo "⬇️  Pulling latest..."
git pull --ff-only origin main
mkdir -p "$ROOT/data"

if $PM2 describe openletterhk >/dev/null 2>&1; then
  echo "🔄 Reloading PM2 process..."
  $PM2 reload openletterhk
else
  echo "▶️  Starting PM2 process..."
  $PM2 start "$ROOT/ecosystem.config.js"
fi
$PM2 save >/dev/null

echo "⏳ Health check..."
for i in \$(seq 1 20); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/healthz"; then
    echo "✅ Healthy"
    exit 0
  fi
  sleep 1
done
echo "❌ Health check failed"
$PM2 logs openletterhk --lines 20 --nostream
exit 1
ENDSSH

echo ""
echo "✨ Deployed. https://openletterhk.org"
