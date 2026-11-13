#!/bin/sh
# Local production: trigger the Worker's scheduled handler back to back while worklist rows need a
# rescore or a view rebuild, else every 5 minutes. Run from the repository root beside
# `vite preview --port 5173`.
#
# The stale count is read read-only from the D1 file. That read fails while the Worker has the
# database closed (its WAL index is gone), so a failed read is retried and, if it still fails,
# reported as unknown and treated as stale: it must never pass for "nothing to do".
set -eu
D=$(ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | grep -v metadata.sqlite)
URL=${VOCNET_URL:-http://localhost:5173}
read_stale() {
  for _ in 1 2 3 4 5; do
    if n=$(sqlite3 -readonly -cmd ".timeout 30000" "$D" \
      "select count(*) from worklist where revision <> scored_revision or revision <> view_revision" 2>/dev/null); then
      echo "$n"
      return
    fi
    sleep 2
  done
  echo unknown
}
while true; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 600 "$URL/cdn-cgi/handler/scheduled" || true)
  stale=$(read_stale)
  echo "$(date +%T) $code stale=$stale"
  if [ "$stale" = unknown ] || [ "$stale" -gt 0 ]; then sleep 2; else sleep 300; fi
done
