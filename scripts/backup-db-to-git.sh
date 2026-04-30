#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${SSH_HOST:-13.206.189.158}"
SSH_USER="${SSH_USER:-ubuntu}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-whatsappApi.pem}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/whatsapp}"
BACKUP_REPO="${BACKUP_REPO:-git@github.com:akhilsabuv/whatsappMultiBackupDB.git}"
BACKUP_REPO_DIR="${BACKUP_REPO_DIR:-$PWD/backups/whatsappMultiBackupDB}"

if [[ "$SSH_KEY" != /* ]]; then
  SSH_KEY="$PWD/$SSH_KEY"
fi

timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_file="whatsapp-platform-${timestamp}.dump"

mkdir -p "$(dirname "$BACKUP_REPO_DIR")"
if [ ! -d "$BACKUP_REPO_DIR/.git" ]; then
  git clone "$BACKUP_REPO" "$BACKUP_REPO_DIR"
fi

cd "$BACKUP_REPO_DIR"
git checkout -B main
mkdir -p database

ssh -i "$SSH_KEY" -p "$SSH_PORT" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "$SSH_USER@$SSH_HOST" \
  "cd '$DEPLOY_PATH' && set -a && . ./.env && set +a && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --format=custom --no-owner --no-privileges" \
  > "database/$backup_file"

if [ ! -s "database/$backup_file" ]; then
  echo "Backup file is empty: database/$backup_file" >&2
  exit 1
fi

cat > latest.json <<JSON
{
  "filename": "$backup_file",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sourceHost": "$SSH_HOST"
}
JSON

git add database latest.json
git commit -m "Back up database $timestamp"
git push origin main

echo "Created and pushed database backup: $backup_file"
