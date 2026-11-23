#!/bin/bash
# Nightly: pg_dump (custom format, compressed) -> AES-256 encrypted -> S3 (30-day lifecycle on the bucket).
# The passphrase lives in SSM (/somacue/prod/BACKUP_PASSPHRASE). Keep a copy of it outside this server.
set -euo pipefail
. /etc/somacue/config            # REGION, BACKUPS_BUCKET
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OBJECT="db/somacue-$STAMP.dump.enc"
metric() { aws cloudwatch put-metric-data --namespace SomaCue --metric-name BackupSuccess --value "$1" --region "$REGION" || true; }
trap 'rc=$?; if [ $rc -ne 0 ]; then echo "backup FAILED ($rc)"; metric 0; fi' EXIT

export BACKUP_PASSPHRASE
BACKUP_PASSPHRASE="$(aws ssm get-parameter --name /somacue/prod/BACKUP_PASSPHRASE --with-decryption --region "$REGION" --query Parameter.Value --output text)"

runuser -u postgres -- pg_dump --format=custom --compress=6 --no-owner somacue \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
  | aws s3 cp - "s3://$BACKUPS_BUCKET/$OBJECT" --sse AES256 --region "$REGION" --only-show-errors

SIZE="$(aws s3api head-object --bucket "$BACKUPS_BUCKET" --key "$OBJECT" --region "$REGION" --query ContentLength --output text)"
if [ "${SIZE:-0}" -lt 512 ]; then echo "backup is suspiciously small ($SIZE bytes)"; exit 1; fi
echo "backup ok: $OBJECT ($SIZE bytes)"
metric 1

# Optional uptime-monitor ping (for example healthchecks.io). Put the URL in /etc/somacue/ping-url.
if [ -s /etc/somacue/ping-url ]; then curl -fsS -m 10 --retry 3 "$(cat /etc/somacue/ping-url)" >/dev/null || true; fi
