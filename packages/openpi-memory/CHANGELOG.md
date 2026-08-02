# Changelog

## [Unreleased]

### Added

- Semantic embedding rerank for memory search: when `OPENPI_EMBEDDING_API_KEY` is set (base URL/model configurable), query results are blended with embedding similarity (`semanticSearch`, default true). Degrades silently to hash-vector + BM25 without a key or on API failure.

## [0.80.8] - 2026-07-24

### Added

- **Proactive cross-session recall**: every user turn auto-injects ranked long-term memory (`proactiveInject`, default on); user need not ask to search.
- **Session digest** on shutdown (`autoSessionDigest`): `project/session-YYYY-MM-DD` so the next chat knows last focus.
- **Global promote** for user/feedback extracts (`promoteUserToGlobal`, default on → `~/.pi/memory`).
- Soft mid-turn extract for work-focus / decisions without explicit “记住” (`softExtractEveryTurn`).
- Session digests capture **assistant conclusions** (tables, scores, named projects), not only the last user line; inject expands digest **body** so “上次聊到哪” can answer with concrete facts.
- Mid-session digest refresh on `agent_end` / `agent_settled` (debounced) so continuity survives crashes without waiting for clean shutdown; session-* digests force-overwrite same-day keys.

### Changed

- Vector store primary format is compact **`vectors.bin`** (Float32 matrix); scales past JSON `stringify` limits. Legacy `vectors.json` still loads once then migrates away on next write.
- Durable **`lexicon.bin`** BM25 inverted index written on reindex; cold start loads without re-tokenizing the corpus.
- Hybrid retrieval: inverted BM25 + tight Float32 cosine loop + bilingual query expansion (ZH↔EN bridges for common agent terms).
- Tiered recall: weak/empty active hits fall through to **`archive/`** soft-deleted memories (`searchArchive`, default on).
- BM25 tokenization is CJK-aware (char unigrams/bigrams/trigrams).
- Broader heuristic extract; inject copy tells the model to apply prior notes without re-asking the user.

### Added

- Initial file-based memory package with freeze snapshot, CRUD tool, compact checkpoint, and optional extract.
- Global memory scope (`scope=global` → `~/.pi/memory`) for save/list/read/delete.
- Default extract-on-shutdown and compact flush guidance.
- Ranked multi-token `query` scoring (key matches outrank value).
- Structured `pending-extract.md` lines: `type:key: summary` or `[type/key] summary`.
- Session-end heuristic extract from user turns (preferences / corrections / deadlines / lessons).
- Index dedupe (near-duplicate values) and keep-newest capacity eviction.
- LLM extract: queue transcript on shutdown, run with current model on next `session_start`.
- AutoDream-style maintenance (merge near-duplicates, prune junk) on session start.
- `query` ranks topic body text when project cwd is available.
- BM25 lexical ranking for memory query (no vector DB).
- Mid-session soft extract on strong preference language (`agent_end`).
- Re-freeze snapshot after save/delete so new memories apply same session.
- `memory` tool action `maintain`; `/memory maintain|status`.
- Maintain global `~/.pi/memory` alongside project memory.
- Desktop: project/global scope, maintain button, meta stats.
- Selective per-turn inject: pin user/feedback, BM25-rank project/lesson against the user prompt (token-budget aware).
- Stronger Chinese/English extract heuristics; queue LLM extract on compact as well as shutdown.
- Local hashed n-gram **vector index** + hybrid vector/BM25 retrieval (no external vector DB).
- Durability: append-only `journal.jsonl`, soft-delete to `archive/`, full `backups/`, recover index from journal/topics.
- Capacity overflow and maintain prunes go to archive (never hard-drop).
- Idle organize on `agent_settled` (backup + maintain + reindex vectors).
- `/memory backup`; default active index cap raised to 500.
- Fully local by default: `llmExtract` defaults to **false** (heuristics + local vectors only; no remote embedding path).
