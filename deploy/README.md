# Mise en ligne de Flexwork sur un VPS (Docker Compose)

Architecture : `caddy` (seul exposé, ports 80/443) → `web` (Next.js) ; `worker` (files et tâches
planifiées) ; `db` (PostgreSQL 16, volume `pgdata`) ; `migrate` (passe unique avant web/worker).
Les fichiers téléversés vivent dans le volume `storage`. Prérequis applicatifs détaillés :
[DEPLOYMENT-PRODUCTION.md](../DEPLOYMENT-PRODUCTION.md).

## 1. Le VPS

- Ubuntu 24.04 LTS, **4 Go de RAM minimum** (le build Next.js en consomme ~2-3 Go), 2 vCPU, 40 Go SSD.
- Ajouter votre clé SSH à la création du serveur.

## 2. Préparer le serveur (une fois)

```bash
ssh root@IP_DU_VPS
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
# Filet de sécurité pour le build si la RAM est juste :
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile \
  && echo '/swapfile none swap sw 0 0' >> /etc/fstab
mkdir -p /opt/flexwork/deploy/backups
```

> Docker publie ses ports en contournant `ufw` : c'est pourquoi seul `caddy` déclare des `ports`.
> Ne jamais en ajouter à `db`, `web` ou `worker`.

## 3. Variables d'environnement

Sur le Mac, envoyer le code une première fois (le build échouera faute de `.env.production`, c'est attendu) :

```bash
deploy/push.sh root@IP_DU_VPS
```

Puis sur le VPS :

```bash
cd /opt/flexwork
cp deploy/env.production.example .env.production
chmod 600 .env.production
for k in POSTGRES_PASSWORD AUTH_SECRET ESCROW_WEBHOOK_SECRET CRON_SECRET; do
  sed -i "s|^$k=\"A_GENERER\"|$k=\"$(openssl rand -hex 32)\"|" .env.production
done
nano .env.production   # NEXT_PUBLIC_APP_URL = http://IP_DU_VPS, SMTP…
```

## 4. Premier lancement

```bash
cd /opt/flexwork
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -s http://localhost/api/health
```

## 5. Reprendre la base et les fichiers locaux

Sur le Mac, à la racine du projet (écrase la base du VPS) :

```bash
deploy/transfer-local-data.sh root@IP_DU_VPS
```

## 6. Mises à jour suivantes

```bash
deploy/push.sh root@IP_DU_VPS    # rsync + rebuild + migrations + redémarrage
```

## 7. Ajouter un domaine plus tard

1. Enregistrement DNS `A` : `app.exemple.com` → IP du VPS.
2. Dans `.env.production` : `SITE_ADDRESS="app.exemple.com"` et
   `NEXT_PUBLIC_APP_URL="https://app.exemple.com"`.
3. `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`
   — Caddy obtient le certificat Let's Encrypt tout seul.

## 8. Sauvegardes

```bash
# /etc/cron.d/flexwork-backup — sauvegarde quotidienne à 2 h, 14 jours conservés
0 2 * * * root cd /opt/flexwork && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > /backups/auto-$(date +\%F).dump' && find deploy/backups -name 'auto-*.dump' -mtime +14 -delete
```

Copier régulièrement `deploy/backups/` et le volume `storage` **hors du VPS**.

## Limites connues avant une vraie production

- **Paiements** : `NODE_ENV=production` coupe la PSP virtuelle. Aucun paiement n'est confirmé
  tant que le webhook d'un vrai PSP (`POST /api/webhooks/psp`) n'est pas branché.
- **OTP SMS** : envoi encore simulé (`src/lib/otp.ts`) ; la connexion par e-mail fonctionne si le SMTP est configuré.
- **E-mails** : sans identifiants SMTP réels, les e-mails restent en échec dans `EmailOutbox`.
