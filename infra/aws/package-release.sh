#!/bin/bash
# Assembles release.tgz from a finished standalone build (run by CodeBuild from the repository root).
#   release/app      the Next.js standalone server, with static files and public assets
#   release/migrate  Prisma CLI + migrations, so the host can run `prisma migrate deploy`
set -euo pipefail
OUT=release
rm -rf "$OUT" release.tgz
mkdir -p "$OUT/app" "$OUT/migrate/prisma"

cp -a apps/web/.next/standalone/. "$OUT/app/"
mkdir -p "$OUT/app/apps/web/.next"
cp -a apps/web/.next/static "$OUT/app/apps/web/.next/static"
cp -a apps/web/public "$OUT/app/apps/web/public"
rm -rf "$OUT/app/apps/web/public/uploads"      # development uploads never ship

# The generated Prisma client is imported at runtime. Make sure it is present even if file tracing missed a file.
mkdir -p "$OUT/app/apps/web/generated"
cp -a apps/web/generated/. "$OUT/app/apps/web/generated/"

cp -a prisma/migrations "$OUT/migrate/prisma/migrations"
cp prisma/schema.prisma "$OUT/migrate/prisma/schema.prisma"
PRISMA_VERSION="$(node -p "require('./package.json').devDependencies.prisma")"
cat > "$OUT/migrate/package.json" <<EOF
{ "name": "somacue-migrate", "private": true, "dependencies": { "prisma": "$PRISMA_VERSION" } }
EOF
cat > "$OUT/migrate/prisma.config.mjs" <<'EOF'
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL },
});
EOF
( cd "$OUT/migrate" && npm install --omit=dev --no-audit --no-fund --loglevel=error )

tar czf release.tgz -C "$OUT" .
ls -l release.tgz
