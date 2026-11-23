#!/bin/bash
# Gets the origin certificate (CloudFront -> nginx leg) with certbot and the Route 53 DNS-01 challenge, then starts
# nginx. Run once the public zone is delegated, so Let's Encrypt can see the challenge record. Needs DOMAIN and
# ALERT_EMAIL. Renewal runs from a systemd timer.
set -euo pipefail
. /etc/somacue/config
: "${DOMAIN:?}"; : "${ALERT_EMAIL:?}"
export AWS_DEFAULT_REGION="$REGION"
/opt/certbot/bin/certbot certonly --dns-route53 --non-interactive --agree-tos -m "$ALERT_EMAIL" \
  --cert-name "origin.$DOMAIN" -d "origin.$DOMAIN" -d "$DOMAIN"
systemctl daemon-reload
systemctl enable --now nginx
systemctl enable --now certbot-renew.timer
nginx -t
echo "origin certificate installed for origin.$DOMAIN and $DOMAIN"
