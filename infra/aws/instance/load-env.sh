#!/bin/bash
# Runs as root before the app and before nginx. Reads every SecureString under /somacue/prod/ and writes the app's
# environment to tmpfs (/run), so no secret is ever stored on the disk image. Files are root-only (mode 0600): systemd
# and nginx read them as root before dropping privileges.
set -euo pipefail
umask 077
REGION="${REGION:-ap-southeast-2}"
RUN=/run/somacue
install -d -m 0700 -o root -g root "$RUN"

raw="$(mktemp -p "$RUN")"
trap 'rm -f "$raw"' EXIT
aws ssm get-parameters-by-path --path /somacue/prod/ --recursive --with-decryption \
  --region "$REGION" --output json > "$raw"

python3 - "$raw" <<'PY'
import json, os, sys

# Values the web app must never see: database admin and backup material, and the CloudFront shared secret
# (only nginx needs that one).
HIDDEN = {"DB_OWNER_PASSWORD", "DB_APP_PASSWORD", "BACKUP_PASSPHRASE", "X_ORIGIN_VERIFY"}

params = json.load(open(sys.argv[1]))["Parameters"]
values = {p["Name"].rsplit("/", 1)[1]: p["Value"] for p in params}

def quote(value):
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'

def write(path, text):
    fd = os.open(path + ".new", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(text)
    os.replace(path + ".new", path)

lines = [f"{k}={quote(v)}" for k, v in sorted(values.items()) if k not in HIDDEN and "\n" not in v]
write("/run/somacue/env", "\n".join(lines) + "\n")

verify = values.get("X_ORIGIN_VERIFY", "")
if len(verify) < 32 or not verify.isalnum():
    sys.exit("X_ORIGIN_VERIFY is missing or malformed")
write(
    "/run/somacue/origin-verify.conf",
    "map $http_x_origin_verify $origin_ok {\n  default 0;\n  \"%s\" 1;\n}\n" % verify,
)
PY
