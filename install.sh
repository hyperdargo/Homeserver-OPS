#!/usr/bin/env bash
# ==============================================================================
# Homeserver Ops — Automated Deployment & Setup Script
# Author: Ankit Gupta (HyperDargo)
# Repository: https://github.com/hyperdargo/Homeserver-OPS
# ==============================================================================

set -euo pipefail

INFO="[INFO]"
SUCCESS="[SUCCESS]"
WARN="[WARN]"

echo "=========================================================="
echo "    HOMESERVER OPS — Automated Server Setup"
echo "=========================================================="

# 1. Check Python version
if ! command -v python3 &>/dev/null; then
    echo "$INFO Installing python3 and dependencies..."
    sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv smartmontools
fi

# 2. Setup Virtual Environment / Requirements
echo "$INFO Installing Python requirements..."
pip3 install --user -r requirements.txt || pip3 install -r requirements.txt

# 3. Create Systemd User Unit Directory
SYSTEMD_DIR="${HOME}/.config/systemd/user"
mkdir -p "${SYSTEMD_DIR}"

CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "$INFO Configuring systemd service..."
cat <<EOF > "${SYSTEMD_DIR}/homeserver-ops.service"
[Unit]
Description=Homeserver Ops Dashboard & AI Companion
After=network.target

[Service]
Type=simple
WorkingDirectory=${CURRENT_DIR}
ExecStart=$(command -v python3) ${CURRENT_DIR}/app.py
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1
Environment=PORT=9090

[Install]
WantedBy=default.target
EOF

# 4. Enable Linger and Service
echo "$INFO Enabling lingering and starting user service..."
loginctl enable-linger "${USER}" || true
systemctl --user daemon-reload
systemctl --user enable --now homeserver-ops.service

# 5. Firewall Recommendation
echo ""
echo "$SUCCESS Deployment complete!"
echo "$INFO Dashboard is running on port 9090."
echo "$INFO To allow port 9090 on UFW, run:"
echo "       sudo ufw allow 9090/tcp comment 'Homeserver Ops Dashboard'"
echo ""
echo "Access your dashboard at: http://localhost:9090"
echo "=========================================================="
