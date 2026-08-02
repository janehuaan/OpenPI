# @earendil-works/openpi-memory

File-based long-term memory for OpenPI — **100% local**: disk files only, offline vectors, no remote embedding/vector service.

## Guarantees

| Promise | How |
|---------|-----|
| **All local** | Data under `.pi/memory` + `~/.pi/memory` only; no cloud memory backend |
| **Find by meaning** | Hybrid **local vector + BM25** (hashed n-gram embeddings in `vectors.bin`, offline) |
| **Proactive cross-chat** | Every turn auto-injects ranked notes — user does not need to say “search memory” |
| **Idle self-organize** | `agent_settled` + session-start AutoDream: merge, prune→archive, reindex vectors, backup |
| **Never lose** | Append-only `journal.jsonl` · soft-delete to `archive/` · full `backups/` · recover index from journal/topics |

Active index may cap (default 500) for prompt quality; **archived + journaled rows are permanent**.

**Not used (by design):** remote embeddings, hosted vector DBs, cloud memory APIs.  
Optional `llmExtract` stays **off by default**; if you turn it on it only uses your already-configured session model (still no remote vector pipeline).

## Disk layout

```text
.pi/memory/
  MEMORY.md           # active index
  meta.json           # maintain / idle / extract timestamps
  vectors.bin         # local embeddings (binary Float32)
  lexicon.bin         # durable BM25 inverted index
  journal.jsonl       # append-only mutation log
  archive/YYYY-MM-DD/ # soft-deleted & pruned (forever)
  backups/<iso>/      # full snapshots before maintain
  user-*.md | feedback-*.md | project-*.md | lesson-*.md
```

Global mirror: `~/.pi/memory/` (same layout).  
Legacy `vectors.json` is read once if present, then replaced by `vectors.bin` on the next reindex/save.

## Retrieval

```text
memory({ action: "query", keyword: "你随便说一句相关的话" })
```

1. Expand query (light ZH↔EN bridges for agent vocabulary)  
2. Embed (words + char n-grams → 384-d hashed vector)  
3. Cosine against `vectors.bin` (cached Float32 matrix)  
4. BM25 via `lexicon.bin` inverted postings (CJK-aware)  
5. Blend α·vector + (1-α)·BM25  
6. If active hits empty/weak → search `archive/` (soft-deleted), merge ranks  

Per-turn inject: pin `user`/`feedback`, hybrid-rank the rest against the user prompt.

## Lifecycle

1. **session_start** — recover · reindex project+global · maintain · freeze · standing “auto-recall” note  
2. **before_agent_start** — **proactive** hybrid inject (pin prefs + session digests + ranked hits)  
3. **agent_end** — soft/high-confidence extract (no “记住” required for WIP/decisions)  
4. **agent_settled** — idle organize when due  
5. **before_compact** — extract + queue LLM  
6. **session_shutdown** — heuristic extract + **session digest** + reindex  

## Commands

```text
/memory           # status + archive counts
/memory maintain  # organize now (backup first)
/memory backup    # full snapshot now
```

## Config

`.pi/memory/config.json`:

```json
{
  "vectorSearch": true,
  "vectorAlpha": 0.55,
  "searchArchive": true,
  "archiveSearchLimit": 5000,
  "archiveSearchMinScore": 0.25,
  "proactiveInject": true,
  "softExtractEveryTurn": true,
  "autoSessionDigest": true,
  "digestRefreshDuringSession": true,
  "digestRefreshMinIntervalMs": 90000,
  "promoteUserToGlobal": true,
  "softDelete": true,
  "autoBackup": true,
  "maxBackups": 40,
  "idleOrganize": true,
  "idleOrganizeMinIntervalMs": 1800000,
  "maxIndexEntries": 500,
  "maxSnapshotEntries": 28,
  "pinTypes": ["user", "feedback"],
  "llmExtract": false,
  "extractOnAgentEnd": true,
  "autoMaintain": true,
  "maintainGlobal": true
}
```

## Install

```bash
pi -e packages/openpi-memory/src/index.ts
```
