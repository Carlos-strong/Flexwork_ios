#!/usr/bin/env bash
# Copie la base locale (flexwork_dev) et les fichiers téléversés (./storage) vers le VPS.
# À lancer depuis la racine du projet, sur le Mac :   deploy/transfer-local-data.sh root@IP_DU_VPS
#
# ÉCRASE la base du VPS : à réserver à la première mise en ligne.
set -euo pipefail

TARGET="${1:?usage: deploy/transfer-local-data.sh utilisateur@ip}"
REMOTE_DIR="/opt/flexwork"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="flexwork-${STAMP}.dump"
LOCAL_URL="$(grep '^DATABASE_URL' .env | cut -d'"' -f2 | sed 's/?schema=public//')"

echo "→ Export de la base locale"
pg_dump --format=custom --no-owner --no-privileges "$LOCAL_URL" -f "/tmp/${DUMP}"

echo "→ Archive des fichiers téléversés"
tar -czf "/tmp/storage-${STAMP}.tgz" -C storage .

echo "→ Envoi vers ${TARGET}"
scp "/tmp/${DUMP}" "${TARGET}:${REMOTE_DIR}/deploy/backups/"
scp "/tmp/storage-${STAMP}.tgz" "${TARGET}:/tmp/"

echo "→ Restauration sur le VPS"
ssh "$TARGET" bash -s <<EOF
set -euo pipefail
cd ${REMOTE_DIR}
DC="docker compose --env-file .env.production -f docker-compose.prod.yml"
set -a; . ./.env.production; set +a
\$DC stop web worker
\$DC exec -T db pg_restore --clean --if-exists --no-owner --role="\$POSTGRES_USER" \
  -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" /backups/${DUMP}
\$DC run --rm -T --no-deps -v /tmp:/import web sh -c 'tar -xzf /import/storage-${STAMP}.tgz -C /app/storage'
rm -f /tmp/storage-${STAMP}.tgz
\$DC run --rm migrate
\$DC up -d web worker
EOF

rm -f "/tmp/${DUMP}" "/tmp/storage-${STAMP}.tgz"
echo "✓ Base et fichiers transférés."
