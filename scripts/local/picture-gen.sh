#!/usr/bin/env bash
# Draws one picture job of scripts/local/pictures.py through the model gateway (docs/design.md,
# Pictures): the job's sense, or with "example" its example sentence, in the house style, square
# and saved as a 1024x1024 WebP. The gateway is MODEL_BASE_URL and MODEL_API_KEY, from .dev.vars
# unless set, and the model is IMAGE_MODEL (default the ChatGPT subscription's image model). A safety
# refusal is final; a rate limit waits for its window.
#
#   bash scripts/local/picture-gen.sh <job json> <dir> [example]
set -uo pipefail
job=$1 out=$2 mode=${3:-sense}
vars="$(dirname "$0")/../../.dev.vars"
: "${MODEL_BASE_URL:=$(grep '^MODEL_BASE_URL=' "$vars" | cut -d= -f2-)}"
: "${MODEL_API_KEY:=$(grep '^MODEL_API_KEY=' "$vars" | cut -d= -f2- | tr -d '"')}"
: "${IMAGE_MODEL:=codex/gpt-image-2.6-flare}"
sid=$(jq -r '.sense.id' <<< "$job"); lemma=$(jq -r '.lemma' <<< "$job"); pos=$(jq -r '.sense.pos' <<< "$job"); gloss=$(jq -r '.sense.gloss' <<< "$job")
name=$sid; [ "$mode" = example ] && name=$sid.example
[ -f "$out/$name.webp" ] && exit 0
# The model draws the same person every time unless told whom to draw, so the sense id picks one.
ages=(young middle-aged older elderly); people=("East Asian woman" "Black man" "South Asian woman" "white man" "Latina woman" "Middle Eastern man" "Black woman" "East Asian man" "white woman" "Latino man" "South Asian man" "Middle Eastern woman")
looks=("short grey hair and a teal jacket" "a shaved head and an orange shirt" "a long braid and a green sweater" "glasses and a navy coat" "a ponytail and a yellow top" "curly red hair and a striped shirt" "short dark hair and a brown jacket" "a bob haircut and a red cardigan" "a knitted beanie and a blue jumper" "straight black hair and a white shirt")
h=$(printf %s "$sid" | cksum | cut -d' ' -f1)
person="a ${ages[h % 4]} ${people[h / 4 % 12]} with ${looks[h / 48 % 10]}"
if [ "$mode" = example ]; then
  sentence=$(jq -r '.sense.example.text' <<< "$job")
  purpose="This picture goes next to an example sentence in an English learner's dictionary. A learner who sees it should understand the sentence, and through it this meaning of the word, at a glance and without reading."
  subject="Word: \"$lemma\" ($pos)
Meaning: $gloss
Example sentence to show: \"$sentence\""
else
  purpose="This picture goes next to one meaning of an English word in a learner's dictionary. A learner who sees it should grasp and remember this meaning at a glance and without reading, and tell it apart from the word's other meanings, so show exactly this meaning, not another sense of the same word."
  subject="Word: \"$lemma\" ($pos)
Meaning to show: $gloss"
fi
prompt="$purpose

$subject

How to show it: one single scene, not a collage or several panels, with the meaning at the centre of attention. If the meaning is a physical object, substance, animal, plant or place, draw only that thing, large and centred, with no people or hands. For an action, state, quality or idea, show the one moment that makes it obvious, through the scene rather than a thought bubble or symbols. When people appear, the main person is $person, and any others look different from each other; people are adults unless the meaning is about children.

Style: flat vector illustration, clean, friendly and modern, soft colours on a plain off-white background, simple shapes, no clutter. A full-bleed square image with no border or frame, every important element well inside the edges. No text, letters, writing on signs, logos, brand names or brand patterns anywhere. Suitable for all ages: no blood, wounds, or dead bodies shown."
tmp=$(mktemp -d)
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  jq -n --arg m "$IMAGE_MODEL" --arg p "$prompt" '{model:$m,prompt:$p,n:1,size:"1024x1024"}' \
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
