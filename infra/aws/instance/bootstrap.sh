#!/bin/bash
# Prepares a fresh Amazon Linux 2023 (Arm64) host: packages, swap, users, directories, services, agents.
# Idempotent. Run as root over SSM Run Command with these variables:
#   REGION DOMAIN ALERT_EMAIL ARTIFACTS_BUCKET BACKUPS_BUCKET UPLOADS_BUCKET
# The scripts it installs are fetched from s3://$ARTIFACTS_BUCKET/scripts/.
# PostgreSQL is installed and configured by setup-postgres.sh (run afterwards).
set -euo pipefail
: "${REGION:?}" "${DOMAIN:?}" "${ALERT_EMAIL:?}" "${ARTIFACTS_BUCKET:?}" "${BACKUPS_BUCKET:?}" "${UPLOADS_BUCKET:?}"
log() { echo "[bootstrap] $*"; }
ROOT=/opt/somacue

log "packages"
dnf -y install nginx jq cronie openssl tar gzip python3 python3-pip amazon-cloudwatch-agent logrotate nodejs22 nodejs22-npm 2>&1 | tail -n 3 \
  || dnf -y install nginx jq cronie openssl tar gzip python3 python3-pip amazon-cloudwatch-agent logrotate nodejs 2>&1 | tail -n 3
dnf -y upgrade --security 2>&1 | tail -n 2 || true
node --version

log "2 GiB swap file"
if ! swapon --show=NAME --noheadings | grep -q '^/swapfile'; then
  if [ ! -f /swapfile ]; then
    dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
fi
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=20' > /etc/sysctl.d/90-somacue.conf
sysctl -q -p /etc/sysctl.d/90-somacue.conf

log "user and directories"
id somacue >/dev/null 2>&1 || useradd --system --home-dir "$ROOT" --shell /sbin/nologin somacue
install -d -o somacue -g somacue "$ROOT" "$ROOT/releases" /var/log/somacue
install -d -m 0755 "$ROOT/bin" /etc/somacue
cat > /etc/somacue/config <<EOF
REGION=$REGION
DOMAIN=$DOMAIN
ALERT_EMAIL=$ALERT_EMAIL
ARTIFACTS_BUCKET=$ARTIFACTS_BUCKET
BACKUPS_BUCKET=$BACKUPS_BUCKET
UPLOADS_BUCKET=$UPLOADS_BUCKET
EOF
chmod 0644 /etc/somacue/config

log "installing scripts and unit files from S3"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
aws s3 cp "s3://$ARTIFACTS_BUCKET/scripts/" "$TMP/" --recursive --region "$REGION" --only-show-errors
for s in load-env.sh deploy.sh backup.sh restore-db.sh healthcheck.sh issue-cert.sh setup-postgres.sh; do
  [ -f "$TMP/$s" ] && install -m 0750 -o root -g root "$TMP/$s" "$ROOT/bin/$s"
done
install -m 0644 "$TMP/somacue.service" /etc/systemd/system/somacue.service
install -m 0644 "$TMP/certbot-renew.service" /etc/systemd/system/certbot-renew.service
install -m 0644 "$TMP/certbot-renew.timer" /etc/systemd/system/certbot-renew.timer
install -m 0644 "$TMP/cron-somacue" /etc/cron.d/somacue
install -m 0644 "$TMP/logrotate-somacue" /etc/logrotate.d/somacue
install -m 0644 "$TMP/nginx.conf" /etc/nginx/nginx.conf
install -m 0644 "$TMP/cwagent.json" /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

log "nginx waits for the secrets file and the certificate"
install -d /etc/systemd/system/nginx.service.d
cat > /etc/systemd/system/nginx.service.d/somacue.conf <<'EOF'
[Unit]
After=network-online.target
Wants=network-online.target
[Service]
ExecStartPre=
ExecStartPre=+/opt/somacue/bin/load-env.sh
ExecStartPre=/usr/sbin/nginx -t
EOF

log "certbot (Route 53 DNS-01)"
if [ ! -x /opt/certbot/bin/certbot ]; then
  python3 -m venv /opt/certbot
  /opt/certbot/bin/pip install --quiet --upgrade pip
  /opt/certbot/bin/pip install --quiet certbot certbot-dns-route53
fi

log "services"
systemctl daemon-reload
systemctl enable --now crond
systemctl enable somacue
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json >/dev/null
log "done"
