#!/usr/bin/env bash
# Builds web/ for Cloudflare Pages deploy. Substitutes the API base URL into index.html.
#
# Usage:
#   API_BASE=https://api.translate.your-domain.com ./scripts/build-web.sh
#
# Output: web-dist/  (deploy this directory with `wrangler pages deploy web-dist`)

set -euo pipefail

API_BASE="${API_BASE:-https://api.translate.your-domain.com}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/web"
DST="$ROOT/web-dist"

rm -rf "$DST"
cp -R "$SRC" "$DST"

# Substitute the api-base meta tag content in every page that uses it.
for page in index.html u.html g.html; do
  if [ -f "$DST/$page" ]; then
    sed -i.bak "s|<meta name=\"api-base\" content=\"\"|<meta name=\"api-base\" content=\"$API_BASE\"|" "$DST/$page"
    rm -f "$DST/$page.bak"
  fi
done

echo "[build-web] API_BASE=$API_BASE"
echo "[build-web] output: $DST"
