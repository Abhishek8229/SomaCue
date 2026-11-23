#!/bin/bash
# Installs one release and switches to it, with a health check and automatic rollback.
# Usage: deploy.sh releases/<id>/release.tgz     (run as root through SSM Run Command)
set -euo pipefail
KEY="${1:?usage: deploy.sh releases/<id>/release.tgz}"
. /etc/somacue/config            # REGION, ARTIFACTS_BUCKET
ROOT=/opt/somacue
ID="$(basename "$(dirname "$KEY")")"
DIR="$ROOT/releases/$ID"
log() { echo "[deploy $ID] $*"; }

health() {
  for _ in $(seq 1 40); do
    if curl -fsS -m 4 http://127.0.0.1:3100/api/health >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

PREVIOUS="$(readlink -f "$ROOT/current" 2>/dev/null || true)"

log "downloading $KEY"
install -d -o somacue -g somacue "$ROOT/releases"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
aws s3 cp "s3://$ARTIFACTS_BUCKET/$KEY" "$TMP/release.tgz" --region "$REGION" --only-show-errors
rm -rf "$DIR"; mkdir -p "$DIR"
tar xzf "$TMP/release.tgz" -C "$DIR"
chown -R somacue:somacue "$DIR"

log "running database migrations"
OWNER_PASSWORD="$(aws ssm get-parameter --name /somacue/prod/DB_OWNER_PASSWORD --with-decryption --region "$REGION" --query Parameter.Value --output text)"
export DATABASE_URL="postgresql://somacue_owner:${OWNER_PASSWORD}@127.0.0.1:5432/somacue"
( cd "$DIR/migrate" && HOME="$ROOT" runuser -u somacue -p -- node node_modules/prisma/build/index.js migrate deploy )
unset DATABASE_URL OWNER_PASSWORD

log "switching to the new release"
ln -sfn "$DIR" "$ROOT/current.new"
mv -T "$ROOT/current.new" "$ROOT/current"
systemctl restart somacue

if health; then
  log "healthy"
else
  log "UNHEALTHY, rolling back"
  journalctl -u somacue -n 40 --no-pager | sed 's/\(password\|secret\|key\)=[^ ]*/\1=***/Ig' || true
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ]; then
    ln -sfn "$PREVIOUS" "$ROOT/current.new"; mv -T "$ROOT/current.new" "$ROOT/current"
    systemctl restart somacue
    health && log "rolled back to $(basename "$PREVIOUS")" || log "rollback is unhealthy too"
  fi
  exit 1
fi

# keep the three newest releases and the one in use
ls -1dt "$ROOT"/releases/*/ | tail -n +4 | while read -r old; do
  [ "$(readlink -f "$ROOT/current")" = "${old%/}" ] || rm -rf "$old"
done
log "done"
