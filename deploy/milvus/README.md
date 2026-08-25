# OpenPI local Milvus

This directory is an **operator-run** Milvus standalone deployment for OpenPI memory. It is not started by OpenPI, the desktop application, or the package manager. Docker must remain running while an OpenPI build configured for Milvus is in use.

## Prerequisites

- Docker Desktop or Docker Engine with Docker Compose v2 (`docker compose version`)
- A local OpenPI build configured for the target Qwen3 embedding + Milvus memory backend

The Milvus gRPC port is bound only to `127.0.0.1:19530`; it is not reachable from the LAN. The bundled etcd and MinIO services have no host port bindings.

## Operate

Run all commands from this directory:

```bash
cd deploy/milvus

# Start in the background
docker compose up -d

# Show service and health state
docker compose ps

# Stop containers but preserve all data
docker compose down

# Start them again
docker compose up -d
```

`milvus` becomes `healthy` after its `/healthz` probe succeeds. Verify explicitly:

```bash
docker compose ps
docker inspect --format '{{.State.Health.Status}}' openpi-milvus
```

The expected health status is `healthy`. To inspect startup failures:

```bash
docker compose logs --tail=200 milvus
```

## Data and collection relationship

The named Docker volumes `openpi-milvus-data`, `openpi-milvus-etcd`, and `openpi-milvus-minio` persist vector data and Milvus standalone metadata. Locate their host-managed mountpoints with:

```bash
docker volume inspect openpi-milvus-data openpi-milvus-etcd openpi-milvus-minio
```

For the target architecture, Qwen3 produces the embedding vector and Milvus stores and searches the corresponding rows. OpenPI should use its configured memory collection; do not share that collection with a model that uses a different embedding dimension, distance metric, or normalization policy. A collection belongs to one compatible embedding-model/index configuration. Changing those settings requires a separate collection or a full re-embedding/rebuild.

## Backup, upgrade, rebuild, and wipe

1. **Backup.** Stop the stack first for a consistent local backup, then archive all three volumes. Docker volume mount paths are host-specific; copy or archive the paths reported by `docker volume inspect` using your normal local backup tool. Keep the backup outside Docker-managed volume paths.

   ```bash
   docker compose down
   docker volume inspect openpi-milvus-data openpi-milvus-etcd openpi-milvus-minio
   ```

2. **Upgrade.** Back up first. Change the explicitly pinned image tag in `docker-compose.yml`, then pull and start:

   ```bash
   docker compose pull
   docker compose up -d
   docker compose ps
   ```

   Review Milvus release compatibility notes before crossing major or minor versions. Roll back only from a tested backup if the new data format is incompatible.

3. **Rebuild an index/collection.** Stop OpenPI writers, use the OpenPI memory backend's supported rebuild or re-embedding operation for the configured collection, then verify queries. Do not delete a collection merely to change the embedding model unless its source records can be re-ingested.

4. **Wipe all Milvus data.** This is irreversible. Stop the stack, remove the named volumes, then start a clean instance:

   ```bash
   docker compose down
   docker volume rm openpi-milvus-data openpi-milvus-etcd openpi-milvus-minio
   docker compose up -d
   ```

   After a wipe, recreate the OpenPI collection and re-ingest/re-embed its source records.
