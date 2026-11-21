#!/usr/bin/env bash
# Envoie le code du Mac vers le VPS puis reconstruit et relance l'application.
# Depuis la racine du projet :   deploy/push.sh root@IP_DU_VPS
#
# rsync plutôt que git : ce qui part est l'arbre de travail tel qu'il est, commité ou non.
# .env*, storage/, node_modules et les builds locaux ne partent JAMAIS.
set -euo pipefail

TARGET="${1:?usage: deploy/push.sh utilisateur@ip}"
REMOTE_DIR="/opt/flexwork"

rsync -az --delete \
  --exclude '.git/' --exclude 'node_modules/' --exclude '.next*/' \
  --exclude 'storage/' --exclude '.env' --exclude '.env.*' \
  --exclude 'playwright-report/' --exclude 'test-results/' --exclude '.playwright-mcp/' \
  --exclude 'mailpit' --exclude 'mailpit.exe' --exclude 'deploy/backups/' \
  --exclude 'tsconfig.tsbuildinfo' \
  ./ "${TARGET}:${REMOTE_DIR}/"

ssh "$TARGET" "cd ${REMOTE_DIR} && docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build && docker image prune -f"
echo "✓ Déployé. Suivre les journaux : ssh ${TARGET} 'cd ${REMOTE_DIR} && docker compose --env-file .env.production -f docker-compose.prod.yml logs -f web worker'"
