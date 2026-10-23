#!/bin/bash
# Re-render the social card (public/og.png, 2400x1260) from og/card.html with headless Chrome.
set -e
cd "$(dirname "$0")"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1200,630 --virtual-time-budget=3000 --allow-file-access-from-files \
  --screenshot="$PWD/../public/og.png" "file://$PWD/card.html" >/dev/null 2>&1
echo "wrote public/og.png"
