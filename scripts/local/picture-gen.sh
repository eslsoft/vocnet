#!/usr/bin/env bash
# Draws one picture job of scripts/local/pictures.py through the model gateway (docs/design.md,
# Pictures): the job's sense, or with "example" its example sentence, in the house style, cut square
# and saved as a 1024x1024 WebP. The gateway is MODEL_BASE_URL and MODEL_API_KEY, from .dev.vars
# unless set. A safety refusal is final; a rate limit waits for its window.
#
#   bash scripts/local/picture-gen.sh <job json> <dir> [example]
set -uo pipefail
job=$1 out=$2 mode=${3:-sense}
vars="$(dirname "$0")/../../.dev.vars"
: "${MODEL_BASE_URL:=$(grep '^MODEL_BASE_URL=' "$vars" | cut -d= -f2-)}"
: "${MODEL_API_KEY:=$(grep '^MODEL_API_KEY=' "$vars" | cut -d= -f2- | tr -d '"')}"
sid=$(jq -r '.sense.id' <<< "$job"); lemma=$(jq -r '.lemma' <<< "$job"); pos=$(jq -r '.sense.pos' <<< "$job"); gloss=$(jq -r '.sense.gloss' <<< "$job")
name=$sid; [ "$mode" = example ] && name=$sid.example
[ -f "$out/$name.webp" ] && exit 0
STYLE="Flat vector illustration for an English learner's dictionary. Square 1:1 composition. Clean, friendly, modern style with soft colours on a plain off-white background, simple shapes, no clutter. No text, letters, numbers, writing on signs, or logos anywhere in the image. Inclusive, culturally neutral people."
if [ "$mode" = example ]; then
  sentence=$(jq -r '.sense.example.text' <<< "$job")
  subject="Draw one single scene, not a collage or several panels, that shows this example sentence of the English word \"$lemma\" ($pos, meaning: $gloss): \"$sentence\""
else
  subject="Draw one single scene, not a collage or several panels, that shows the main meaning of the English word \"$lemma\" ($pos): $gloss"
fi
prompt="$STYLE

$subject"
tmp=$(mktemp -d)
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  jq -n --arg p "$prompt" '{model:"codex/gpt-image-2.6-flare",prompt:$p,n:1}' \
    | curl -sS -m 300 "$MODEL_BASE_URL/v1/images/generations" -H "Authorization: Bearer $MODEL_API_KEY" -H "Content-Type: application/json" -d @- -o "$tmp/r.json"
  if jq -e '.data[0].b64_json' "$tmp/r.json" >/dev/null 2>&1; then
    jq -r '.data[0].b64_json' "$tmp/r.json" | base64 -d > "$tmp/raw"
    magick "$tmp/raw" -resize 1024x1024^ -gravity center -extent 1024x1024 -quality 80 "$tmp/out.webp" \
      && printf '%s\n' "$prompt" > "$out/$name.prompt.txt" && mv "$tmp/out.webp" "$out/$name.webp" && echo "ok $lemma $name"
    rm -rf "$tmp"; exit 0
  fi
  # A refusal by the safety system is final for this prompt.
  grep -q 'safety system' "$tmp/r.json" 2>/dev/null && break
  # The upstream account rate-limits image generation: wait for its window instead of failing.
  if grep -q 'rate_limit_error\|429' "$tmp/r.json" 2>/dev/null; then
    echo "WAIT $lemma $name 429, attempt $attempt" >&2
    sleep $((attempt * 60))
  else
    sleep $((attempt * 5))
  fi
done
echo "FAIL $lemma $name $(jq -c '.error // .' "$tmp/r.json" 2>/dev/null | head -c 200)"
rm -rf "$tmp"
