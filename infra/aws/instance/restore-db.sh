#!/bin/bash
# Restores a nightly dump into the "somacue" database. DESTRUCTIVE: replaces the current data.
# Usage: restore-db.sh db/somacue-<stamp>.dump.enc --yes
set -euo pipefail
. /etc/somacue/config
KEY="${1:?usage: restore-db.sh db/<file>.dump.enc --yes}"
[ "${2:-}" = "--yes" ] || { echo "Refusing to restore without --yes (this replaces the live database)."; exit 2; }
export BACKUP_PASSPHRASE
BACKUP_PASSPHRASE="$(aws ssm get-parameter --name /somacue/prod/BACKUP_PASSPHRASE --with-decryption --region "$REGION" --query Parameter.Value --output text)"
systemctl stop somacue
aws s3 cp "s3://$BACKUPS_BUCKET/$KEY" - --region "$REGION" --only-show-errors \
  | openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
  | runuser -u postgres -- pg_restore --clean --if-exists --no-owner --role=somacue_owner -d somacue
systemctl start somacue
echo "restored $KEY"
