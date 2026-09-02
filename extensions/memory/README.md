# @openpi/extension-memory

Fully local long-term memory: hashed n-gram vectors + BM25 hybrid retrieval,
per-topic markdown files, append-only journal, soft-delete archive, backups.

## What actually computes vectors

`embedText()` (src/vectors.ts) is a **pure-TS FNV-1a hashed n-gram embedder**,
384 dimensions, no model and no native dependency. Features are whitespace words,
CJK unigrams, and char 2/3-grams, signed-hashed into buckets then L2-normalized.

The old repo's README claimed "bge-small-zh (25 MB, local)" for this package.
That was never true: bge served a *different* feature (coding-agent's
`session_search` rerank) through a bundled llama.cpp server. This package has
always been hash-based. Documented here so the claim does not come back.

If a real embedding backend is wanted later, inject it behind the same
`embedText` interface and keep exactly one vector store - not two as before.

## Files on disk (under `<cwd>/.pi/memory/`)

| file | role |
|---|---|
| `MEMORY.md` | human-readable index, one line per memory |
| `<type>-<key>.md` | topic body |
| `vectors.bin` | Float32 matrix, magic `OPIV`, version 2 |
| `lexicon.bin` | durable BM25 inverted index (cold start without re-tokenizing) |
| `journal.jsonl` | append-only op log; source of truth for recovery |
| `archive/<day>/` | soft-deleted entries, never pruned |
| `backups/<stamp>/` | pre-maintain snapshots, newest 30 kept |

A save journals **twice** by design - once from `saveIndexAt` (index summary),
once from `saveTopicAt` (body). `recoverIndex` collapses them last-write-wins.

## Recovery tiers

`recoverIndex` tries, in order: intact `MEMORY.md` → replay `journal.jsonl` →
rebuild from topic files → empty. `loadActiveOrRecover` is the entry point used
at session start.

## Ported from the old repo

`vectors` / `rank` / `store` / `durability` / `extract` / `maintain` / `snapshot`
are carried over close to verbatim. Dropped: the runtime LLM-extraction path
(off by default, depended on a model-registry API that changed in 0.84) and the
Rust `pi-memsearch` backend (its binary never shipped, so the TS path was always
what ran). `buildLlmExtractPrompt` / `parseLlmExtractResponse` stay as pure
functions.

## Tests

`npm test -w extensions/memory` - 100 tests. The old repo had 38 and left
`vectors.ts`, `rank.ts` and `durability.ts` completely uncovered.
