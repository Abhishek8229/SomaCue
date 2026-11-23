#!/bin/bash
# Installs PostgreSQL 18, binds it to 127.0.0.1 only, tunes it for a 2 GiB host, and creates the database and roles.
# Idempotent. Run as root over SSM after bootstrap.sh.
#   somacue_owner  owns the schema (migrations run as this role)
#   somacue_app    runtime role: SELECT/INSERT/UPDATE/DELETE and sequence use only, no DDL
set -euo pipefail
. /etc/somacue/config
log() { echo "[postgres] $*"; }
PGDATA=/var/lib/pgsql/data

if ! command -v postgres >/dev/null 2>&1 && [ ! -x /usr/pgsql-18/bin/postgres ]; then
  log "installing PostgreSQL 18"
  if dnf -q list --available postgresql18-server >/dev/null 2>&1; then
    dnf -y install postgresql18-server postgresql18-contrib
  else
    log "not in the Amazon Linux repository; using the PostgreSQL project (PGDG) repository for EL9 arm64"
    dnf -y install "https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-aarch64/pgdg-redhat-repo-latest.noarch.rpm"
    dnf -y install postgresql18-server postgresql18-contrib
  fi
fi
BIN=""
for d in /usr/pgsql-18/bin /usr/bin; do [ -x "$d/initdb" ] && "$d/postgres" --version 2>/dev/null | grep -q ' 18\.' && BIN="$d" && break; done
[ -n "$BIN" ] || { echo "PostgreSQL 18 binaries not found"; exit 1; }
log "using $BIN ($("$BIN/postgres" --version))"
# Link the client tools so backup.sh and restore-db.sh find pg_dump and pg_restore.
for t in pg_dump pg_restore psql; do ln -sfn "$BIN/$t" "/usr/local/bin/$t"; done

if [ -d /usr/pgsql-18 ]; then PGDATA=/var/lib/pgsql/18/data; UNIT=postgresql-18; else UNIT=postgresql; fi
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "initialising the cluster (data checksums on)"
  if [ -x /usr/pgsql-18/bin/postgresql-18-setup ]; then
    PGSETUP_INITDB_OPTIONS="--data-checksums --encoding=UTF8 --locale=C.UTF-8" /usr/pgsql-18/bin/postgresql-18-setup initdb
  else
    postgresql-setup --initdb --unit postgresql -- --data-checksums --encoding=UTF8 --locale=C.UTF-8 2>/dev/null \
      || runuser -u postgres -- "$BIN/initdb" -D "$PGDATA" --data-checksums --encoding=UTF8 --locale=C.UTF-8
  fi
fi

log "configuration"
cat > "$PGDATA/conf.d-somacue.conf" <<'EOF'
listen_addresses = '127.0.0.1'
port = 5432
max_connections = 40
shared_buffers = 256MB
effective_cache_size = 768MB
work_mem = 4MB
maintenance_work_mem = 64MB
wal_compression = on
checkpoint_completion_target = 0.9
password_encryption = scram-sha-256
log_min_duration_statement = 1000
log_connections = off
log_line_prefix = '%m [%p] %u@%d '
EOF
grep -q "conf.d-somacue.conf" "$PGDATA/postgresql.conf" || echo "include 'conf.d-somacue.conf'" >> "$PGDATA/postgresql.conf"
cat > "$PGDATA/pg_hba.conf" <<'EOF'
# TYPE  DATABASE  USER      ADDRESS        METHOD
local   all       postgres                 peer
local   all       all                      scram-sha-256
host    all       all       127.0.0.1/32   scram-sha-256
EOF
chown postgres:postgres "$PGDATA/conf.d-somacue.conf" "$PGDATA/pg_hba.conf"; chmod 600 "$PGDATA/conf.d-somacue.conf" "$PGDATA/pg_hba.conf"

systemctl enable "$UNIT" >/dev/null
systemctl restart "$UNIT"
for _ in $(seq 1 30); do runuser -u postgres -- psql -qAt -c 'select 1' >/dev/null 2>&1 && break; sleep 1; done
ss -ltn | awk '$4 ~ /:5432$/ {print "listening on " $4}'
ss -ltn | awk '$4 ~ /:5432$/ && $4 !~ /^127\.0\.0\.1:/ {bad=1} END {exit bad}' || { echo "PostgreSQL is listening on a non-loopback address"; exit 1; }

log "roles and database"
OWNER_PW="$(aws ssm get-parameter --name /somacue/prod/DB_OWNER_PASSWORD --with-decryption --region "$REGION" --query Parameter.Value --output text)"
APP_PW="$(aws ssm get-parameter --name /somacue/prod/DB_APP_PASSWORD --with-decryption --region "$REGION" --query Parameter.Value --output text)"
# Passwords are generated as letters and digits only, so they are safe inside SQL literals.
for v in "$OWNER_PW" "$APP_PW"; do [[ "$v" =~ ^[A-Za-z0-9]{24,}$ ]] || { echo "unexpected password format"; exit 1; }; done
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'somacue_owner') THEN CREATE ROLE somacue_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'somacue_app')   THEN CREATE ROLE somacue_app LOGIN; END IF;
END \$\$;
ALTER ROLE somacue_owner PASSWORD '${OWNER_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE somacue_app   PASSWORD '${APP_PW}'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
SELECT 'CREATE DATABASE somacue OWNER somacue_owner ENCODING ''UTF8'' TEMPLATE template0' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'somacue')\gexec
REVOKE ALL ON DATABASE somacue FROM PUBLIC;
GRANT CONNECT ON DATABASE somacue TO somacue_app;
SQL
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q -d somacue <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO somacue_owner;
GRANT USAGE ON SCHEMA public TO somacue_app;
ALTER DEFAULT PRIVILEGES FOR ROLE somacue_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO somacue_app;
ALTER DEFAULT PRIVILEGES FOR ROLE somacue_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO somacue_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO somacue_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO somacue_app;
SQL
unset OWNER_PW APP_PW

log "ready: $(runuser -u postgres -- psql -qAt -c 'show server_version')"
