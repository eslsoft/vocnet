#!/bin/sh
# Local development: issue a service key for a downstream consumer without an admin sign-in. It
# inserts the service row into the local D1 as POST /manage/v1/services stores it (only the
# SHA-256 hex of the key), and writes the key to a file only its owner can read. Run from the
# repository root with the Worker stopped.
#
#   scripts/local/issue-service-key.sh <service-name> <key-file>
#
# VOCNET_PERSIST names the state directory when the database is not this checkout's
# .wrangler/state (a worktree serving the main checkout's data).
set -eu
NAME=${1:?usage: issue-service-key.sh <service-name> <key-file>}
OUT=${2:?usage: issue-service-key.sh <service-name> <key-file>}
case $NAME in *[!A-Za-z0-9._-]*) echo "The name may hold only letters, digits, '.', '_', and '-'." >&2; exit 2 ;; esac
if [ -e "$OUT" ]; then echo "$OUT exists; revoke that key and remove the file first." >&2; exit 2; fi

KEY=vn_service_$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
HASH=$(printf %s "$KEY" | shasum -a 256 | cut -d' ' -f1)
ID=$(uuidgen | tr 'A-Z' 'a-z')
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

set -- --local
if [ -n "${VOCNET_PERSIST:-}" ]; then set -- "$@" --persist-to "$VOCNET_PERSIST"; fi
pnpm exec wrangler d1 execute vocnet "$@" --command \
  "INSERT INTO services (id,name,key_hash,created_by,created_at) VALUES ('$ID','$NAME','$HASH','admin:local','$NOW')" >/dev/null

(umask 077 && printf '%s\n' "$KEY" >"$OUT")
echo "Issued service $NAME ($ID); its key is in $OUT"
