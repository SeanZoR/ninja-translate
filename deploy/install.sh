#!/usr/bin/env bash
# Bootstrap a fresh Hostinger VPS for ninja-translate.
#
# Run as root after SSH'ing into a fresh Ubuntu 24.04 VPS:
#   curl -fsSL https://raw.githubusercontent.com/SeanZoR/ninja-translate/main/deploy/install.sh | bash
#
# Or copy this script and run it locally with the repo cloned.

set -euxo pipefail

# 1. System packages
apt-get update
apt-get install -y curl ca-certificates gnupg git build-essential python3

# 2. Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
corepack enable

# 3. Doppler CLI
curl -Ls https://cli.doppler.com/install.sh | sh

# 4. Cloudflared (will be configured separately - see deploy/cloudflared.yml)
curl -L https://pkg.cloudflare.com/cloudflared/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
dpkg -i /tmp/cloudflared.deb
rm -f /tmp/cloudflared.deb

# 5. App user + directory
id -u ninja >/dev/null 2>&1 || useradd -m -s /bin/bash ninja

if [ ! -d /opt/ninja-translate ]; then
  git clone https://github.com/SeanZoR/ninja-translate.git /opt/ninja-translate
fi
chown -R ninja:ninja /opt/ninja-translate

# 6. Install dependencies
sudo -u ninja bash -c 'cd /opt/ninja-translate && pnpm install && pnpm rebuild better-sqlite3'

# 7. Doppler service token
cat <<'EOF'
==================================================
Next steps:

  1. Create a Doppler service token for your-project/prd and place it at
     /etc/ninja-translate.doppler.token, then:
        doppler configure set token "$(cat /etc/ninja-translate.doppler.token)" \
            --scope /opt/ninja-translate

  2. As ninja user, run a one-time WA QR pairing:
        sudo -u ninja bash -c 'cd /opt/ninja-translate && doppler run -- pnpm login'

  3. Capture BOT_JID printed at login and add it to Doppler.

  4. Configure cloudflared (see deploy/cloudflared.yml header for steps).

  5. Install + enable the systemd unit:
        cp /opt/ninja-translate/deploy/ninja-translate.service /etc/systemd/system/
        systemctl daemon-reload
        systemctl enable --now ninja-translate

  6. Tail logs: journalctl -u ninja-translate -f
==================================================
EOF
