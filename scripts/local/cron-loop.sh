#!/bin/sh
# Local production: trigger the Worker's scheduled handler back to back while worklist rows are
# stale, else every 5 minutes. Run from the repository root beside `vite preview --port 5173`.
set -eu
D=$(ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | grep -v metadata.sqlite)
URL=${VOCNET_URL:-http://localhost:5173}
while true; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 600 "$URL/cdn-cgi/handler/scheduled" || true)
  stale=$(sqlite3 -readonly -cmd ".timeout 30000" "$D" "select count(*) from worklist where revision <> scored_revision" || echo 0)
  echo "$(date +%T) $code stale=$stale"
  if [ "$stale" -gt 0 ]; then sleep 2; else sleep 300; fi
done
