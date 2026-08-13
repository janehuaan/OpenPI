#!/usr/bin/env python3
"""Parse fetched RSS/X dumps into a digestable JSON for the AI news brief."""
import json
import re
import sys

WORK = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ai-news"

def read(name):
    try:
        return open(f"{WORK}/{name}", encoding="utf-8", errors="ignore").read()
    except FileNotFoundError:
        return ""

def rss_items(text, n=10):
    """Extract title+url pairs from RSS-ish text."""
    out = []
    pat = re.compile(r"([A-Z][A-Za-z0-9 ,'’:.()\-&/!?$%]{25,160})\s*(https?://\S+?)(?:\s|$)")
    for m in pat.finditer(text):
        title = m.group(1).strip()
        url = m.group(2).rstrip(".,;")
        if "nitter" in url or "pic/" in url or "twitter" in url:
            continue
        if title not in [o["title"] for o in out]:
            out.append({"title": title, "url": url})
        if len(out) >= n:
            break
    return out

def x_tweets(text, n=4):
    out = []
    for chunk in text.split("]]>"):
        if len(chunk) < 30:
            continue
        m = re.search(r"https://nitter\.net/\S+/status/(\d+)", chunk)
        sid = m.group(1) if m else None
        hdr = re.search(r"(?:400x400\.jpg|400x400\.png|128128)", chunk)
        body = chunk[hdr.end():] if hdr else chunk
        body = re.split(r"\n\* \* \*\n|\n\n\*\*Link\*\*|\n\n\*\*Quote\*\*", body)[0]
        lines = [l.strip() for l in body.split("\n")
                 if l.strip() and not l.startswith("![](") and not l.startswith("http") and not l.startswith("[")]
        if not lines:
            continue
        txt = " ".join(lines)
        txt = re.sub(r"\s+", " ", txt).strip()
        txt = re.sub(r"^\d+", "", txt).strip()
        if len(txt) > 30 and sid:
            out.append({"text": txt[:300], "id": sid})
        if len(out) >= n:
            break
    return out

rss_names = ["openai", "deepmind", "google", "hf", "mistral", "tc", "verge", "mit", "vb", "ars", "wired", "mtp", "ithome"]
x_names = ["x-openai", "x-anthropic", "x-deepmind", "x-mistral", "x-hf", "x-opencode", "x-sama"]

result = {"rss": {}, "x": {}}
for name in rss_names:
    result["rss"][name] = rss_items(read(f"{name}.md"))
for name in x_names:
    result["x"][name] = x_tweets(read(f"{name}.md"))

print(json.dumps(result, ensure_ascii=False, indent=1))
