# @earendil-works/openpi-memory

OpenPI long-term memory. The **target architecture** is local **Qwen3 embedding + user-operated local Milvus standalone**: Qwen3 creates semantic vectors and Milvus persists and searches the matching collection. It is designed to keep memory data and vector search on the operator's machine rather than using a hosted vector service.

## Deployment status and strict dependencies

The target backend requires both components; it has **no hash-vector or BM25 fallback** when that integration is enabled:

1. A compatible local Qwen3 embedding model in GGUF format, loaded by the embedding runtime.
2. A reachable local Milvus standalone instance and the configured compatible collection.

The deployment compose file is at [`../../deploy/milvus`](../../deploy/milvus). It is explicitly operator-run: OpenPI and OpenPI Desktop do **not** start Docker or Milvus automatically. Start and validate it before using a build that enables the target backend.

Until the Qwen3+Milvus implementation lands in the runtime, existing builds may still use the current file-based memory path. This document describes the intended deployment contract and must not be read as a claim that all current code has already switched to it.

## Qwen model package

Package the Qwen3 embedding model as the Q8_0 GGUF file:

```text
build/embedding/qwen3-embedding-0.6b-q8_0.gguf
```

`Q8_0` is an 8-bit GGUF quantization, chosen for a local resource with substantially lower memory/storage cost than full precision while preserving a practical semantic-retrieval quality target. The model file is a large binary asset (approximately 639 MB) and is intentionally not committed or downloaded by this repository. See the desktop packaging note in [`../openpi-desktop/README.md`](../openpi-desktop/README.md) before building a distributable app.

A collection is tied to one compatible embedding setup (vector dimension, metric, normalization, and model). Do not mix embeddings from a different model/configuration in the same collection; create a new collection or re-embed all records when changing any of those values.

## Local data ownership

Milvus data is held in Docker named volumes; see [`../../deploy/milvus/README.md`](../../deploy/milvus/README.md) for health checks, backup, upgrades, rebuilding, and destructive wipe instructions. Source memory records remain the basis for recovery and re-embedding; back them up separately from the Milvus volumes.

## Install

```bash
pi -e packages/openpi-memory/src/index.ts
```
