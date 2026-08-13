#!/bin/bash
# AI News Digest - fetch all sources (RSS + X via Nitter) for the daily brief.
# Usage: fetch-all.sh <workdir>
set -u
export PATH="/Users/huaan/.nvm/versions/node/v24.18.0/bin:$PATH"
WORK="${1:-/tmp/ai-news}"
mkdir -p "$WORK" && cd "$WORK" || exit 1

# [name] [url]
RSS_SOURCES=(
  "openai|https://openai.com/news/rss.xml"
  "deepmind|https://deepmind.google/blog/rss.xml"
  "google|https://blog.google/technology/ai/rss/"
  "hf|https://huggingface.co/blog/feed.xml"
  "mistral|https://mistral.ai/news/rss.xml"
  "tc|https://techcrunch.com/category/artificial-intelligence/feed/"
  "verge|https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"
  "mit|https://www.technologyreview.com/topic/artificial-intelligence/feed/"
  "vb|https://venturebeat.com/category/ai/feed/"
  "ars|https://arstechnica.com/ai/feed/"
  "wired|https://www.wired.com/feed/tag/ai/latest/rss"
  "mtp|https://www.marktechpost.com/feed/"
  "ithome|https://www.ithome.com/rss/"
)

# [name] [x-handle]
X_SOURCES=(
  "x-openai|OpenAI"
  "x-anthropic|AnthropicAI"
  "x-deepmind|GoogleDeepMind"
  "x-mistral|MistralAI"
  "x-hf|huggingface"
  "x-opencode|opencode"
  "x-sama|sama"
)

fetch() {
  local out="$1" url="$2"
  if [ -s "$WORK/$out" ]; then
    echo "skip $out (exists)"
    return 0
  fi
  echo "fetch $out"
  firecrawl scrape "$url" -o "$WORK/$out" 2>&1 | tail -1
  sleep 3
}

for entry in "${RSS_SOURCES[@]}"; do
  name="${entry%%|*}"; url="${entry##*|}"
  fetch "$name.md" "$url"
done

for entry in "${X_SOURCES[@]}"; do
  name="${entry%%|*}"; handle="${entry##*|}"
  fetch "$name.md" "https://nitter.net/$handle/rss"
done

echo "=== ALL FETCHED ==="
wc -c "$WORK"/*.md 2>/dev/null | tail -20
