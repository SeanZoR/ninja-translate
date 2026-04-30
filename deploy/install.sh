#!/usr/bin/env bash
# Bootstrap a fresh Linux VPS for ninja-translate.
#
# Tested on Ubuntu 24.04. Run as root after SSH:
#   curl -fsSL https://raw.githubusercontent.com/<your-github>/ninja-translate/main/deploy/install.sh | bash
#
# Or copy this script and run it locally with the repo cloned.

set -euxo pipefail

REPO_URL="${REPO_URL:-https://github.com/<your-github>/ninja-translate.git}"
APP_DIR="${APP_DIR:-/opt/ninja-translate}"
APP_USER="${APP_USER:-ninja}"

# 1. System packages
apt-get update
apt-get install -y curl ca-certificates gnupg git build-essential python3

# 2. Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
corepack enable

# 3. Cloudflared (will be configured separately - see deploy/cloudflared.yml)
curl -L https://pkg.cloudflare.com/cloudflared/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
dpkg -i /tmp/cloudflared.deb
rm -f /tmp/cloudflared.deb

# 4. App user + directory
id -u "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"

if [ ! -d "$APP_DIR" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# 5. Install dependencies
sudo -u "$APP_USER" bash -c "cd $APP_DIR && pnpm install && pnpm rebuild better-sqlite3"

# 6. Next steps (manual)
cat <<EOF
==================================================
Next steps:

  1. Provision your env. Either:
        a) Copy .env.example to $APP_DIR/.env and fill in values, OR
        b) Use a secret manager (Doppler / 1Password / etc.) that injects env
           vars into the systemd unit. The app reads from process.env.

  2. As app user, run a one-time WA QR pairing:
        sudo -u $APP_USER bash -c "cd $APP_DIR && pnpm login"

  3. Capture BOT_JID printed at login and add it to your env.

  4. Configure cloudflared (see deploy/cloudflared.yml header for steps).

  5. Install + enable the systemd unit (edit it first to match your env-injection
     approach):
        cp $APP_DIR/deploy/ninja-translate.service /etc/systemd/system/
        systemctl daemon-reload
        systemctl enable --now ninja-translate

  6. Tail logs: journalctl -u ninja-translate -f
==================================================
EOF
