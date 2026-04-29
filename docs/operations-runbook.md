# Operations Runbook

## Observability

- Backend request telemetry is emitted as structured JSON log lines with the `http.request` event name.
- Runtime metrics are available at `GET /health/metrics`.
- Worker failures are written to the Redis `queue:dead-letter` list and exposed through `/health/metrics`.
- Set `ALERT_WEBHOOK_URL` to receive JSON alerts for queue dead-letter events.

## Upload Security

- Uploads are rejected unless extension, browser MIME type, and magic bytes agree.
- Supported uploads: PDF, JPEG, PNG, WebP, and plain text.
- Set `CLAMSCAN_PATH` to a `clamscan` binary path to enable malware scanning.
- Set `REQUIRE_MALWARE_SCAN=true` in production if uploads must fail closed when the scanner is missing.
- Worker cleanup removes uploaded files after send attempts finish.

## Backup

Run a PostgreSQL backup from the host:

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "backups/whatsapp-platform-$(date +%Y%m%d-%H%M%S).dump"
```

Back up uploaded files:

```bash
docker run --rm -v whatsapp_uploads_data:/data -v "$PWD/backups:/backup" alpine tar -czf "/backup/uploads-$(date +%Y%m%d-%H%M%S).tar.gz" -C /data .
```

## Restore

Stop application services before restore:

```bash
docker compose stop backend worker frontend
```

Restore PostgreSQL:

```bash
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < backups/whatsapp-platform.dump
```

Restore uploaded files:

```bash
docker run --rm -v whatsapp_uploads_data:/data -v "$PWD/backups:/backup" alpine sh -c "rm -rf /data/* && tar -xzf /backup/uploads.tar.gz -C /data"
```

Restart services:

```bash
docker compose up -d backend worker frontend
```

## Dead-Letter Triage

Inspect recent failed jobs:

```bash
docker compose exec redis redis-cli LRANGE queue:dead-letter 0 20
```

After fixing the root cause, retry messages from the dashboard/API flow rather than replaying raw jobs blindly.

