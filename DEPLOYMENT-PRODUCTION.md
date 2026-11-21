# Déploiement production — prérequis opérationnels (rate-limit & IP)

Récapitulatif des prérequis **obligatoires** avant mise en production réelle de l'app FlexWork
(Next.js, dossier `src/`). Concerne le middleware de rate-limit (`src/middleware.ts`) et les
limites anti-spam OTP (`src/lib/otp.ts`). Un pointage en est fait en tête de chacun de ces
deux fichiers.

---

## 1. L'app DOIT être derrière un reverse-proxy de confiance

Le rate-limit (middleware **et** OTP par IP) détermine l'IP du client via les headers
`x-forwarded-for` (premier hop) puis `x-real-ip` — logique `getClientIp` partagée entre
`src/lib/otp.ts` et `src/middleware.ts`.

- **Obligatoire** : un reverse-proxy (Nginx / Caddy / Cloudflare / ALB / Traefik…) doit
  **écraser** ces headers avec la vraie adresse du client avant que l'app ne les lise.
- **L'app ne doit être joignable QUE derrière ce proxy** (aucun port Next.js exposé
  directement sur Internet).
- Sinon, l'IP est une valeur **déclarée par le client** : un attaquant la fait varier à chaque
  requête et contourne **toutes** les limites par IP. Vérifié empiriquement (2026-08-20) :
  150 requêtes en rotant `x-forwarded-for` → **0 bloquée** (150×200).

⚠️ Tant que cette topologie n'est pas confirmée (proxy qui écrase le header + app qui n'écoute
que derrière lui), **ne pas déployer en confiance** sur le rate-limit par IP.

---

## 2. Le compteur de rate-limit du middleware : en mémoire ou partagé

`src/middleware.ts` compte via `src/lib/rate-limit.ts` :

- **Sans configuration** : `Map` en mémoire du process — valable pour **une seule instance**
  (chaque instance aurait sinon son propre compteur : limites multipliées par le nombre
  d'instances, remises à zéro au redémarrage).
- **Plusieurs instances** : définir `RATE_LIMIT_REDIS_REST_URL` et `RATE_LIMIT_REDIS_REST_TOKEN`
  → compteur **partagé** dans Redis, voir §8.1. En cas de panne de Redis, chaque instance
  retombe sur son compteur local (limite approximative, jamais absente).

> La limite OTP par IP, elle, est stockée en base (`OtpRequestAttempt.ip`, purge paresseuse
> toutes les 10 min) → partagée entre instances, pas de souci multi-instance de ce côté.

---

## 3. Limites en place

| Couche | Route | Limite | Fenêtre |
|---|---|---|---|
| Middleware global | toutes pages + API (hors statiques) | **240 req / IP** | 1 min |
| Middleware sensible | `/api/signature/*`, `/api/missions/*/proposals` | **60 req / IP** | 1 min |
| OTP par identifiant | `request-otp` / `signup` | **5 req / identifiant** | 15 min |
| OTP par IP | `request-otp` / `signup` | **100 req / IP** | 15 min |

> Le rate-limit du middleware est **désactivé en dev/test** (`NODE_ENV !== "production"`) :
> sans proxy, tout le trafic local tombe dans le bucket IP `"unknown"` (un seul seau partagé)
> et bloquait l'utilisateur avec un « Too Many Requests » arbitraire. En production, les
> limites 240/60 évitent les faux positifs (un chargement de page + le polling 30 s de la
> cloche/badges restent très en deçà) tout en bornant l'énumération.

---

## 4. Headers de sécurité

Le middleware pose systématiquement (dev inclus) :
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`.

À compléter au niveau du proxy : **HSTS**, CSP, etc.

---

## 5. Checklist avant mise en production

- [ ] Reverse-proxy configuré (écrase `x-forwarded-for`/`x-real-ip`), port Next non exposé.
- [ ] `AUTH_SECRET` défini (≠ placeholder) — `src/auth.ts` refuse de démarrer sinon.
- [ ] Nombre d'instances Next = 1, **ou** compteur partagé configuré
      (`RATE_LIMIT_REDIS_REST_URL`/`_TOKEN`) — voir §8.1.
- [ ] Sonde `GET /api/health` branchée sur le healthcheck du conteneur et une supervision
      externe ; `ALERT_WEBHOOK_URL` et/ou `ALERT_EMAILS` définis — voir §8.4.
- [ ] Envoi d'emails réel configuré (`src/lib/mail.ts`) — Mailpit est réservé au dev.
- [ ] OTP : provider SMS réel branché en prod (l'envoi est stubbé en dev, voir `src/lib/otp.ts`).
- [ ] Worker déployé (`npm run worker`) et `QUEUE_MODE=worker` sur le
      serveur web — voir §7.

---

## 6. Crons à planifier (expirations temporelles)

> **Avec le worker (§7), rien à planifier ici** : il exécute lui-même toutes ces tâches. Les
> routes ci-dessous restent pour un déploiement sans worker.

Trois endpoints de maintenance doivent être appelés périodiquement (Bearer `CRON_SECRET`,
défini dans `.env`/`.env.example`) — fréquence conseillée : toutes les 10 min, ou au moins
1×/h (les délais étant de 24 h ou 48 h, une exécution à l'heure suffit largement ; une
exécution plus fine rend l'annulation plus réactive) :

| Endpoint | Rôle | Délai |
|---|---|---|
| `GET /api/cron/contract-expirations` | Annule les contrats Mission dont le délai de contre-signature (prestataire 1/2 → client 2/2) est dépassé | 48 h |
| `GET /api/cron/devis-expirations` | Annule les négociations de devis arrivées à échéance | selon mission |
| `GET /api/cron/gig-order-expirations` | Rembourse automatiquement les commandes Gig dont le prestataire n'a pas signé (2/2) sous 24 h après la signature du client (modèle Gig) | 24 h |
| `GET /api/cron/tacit-acceptance` | Acceptation tacite des livrables : libère le paiement d'un livrable soumis que le client n'a pas contesté dans le délai contractuel (clause 3 du contrat de prestation) | `PrestationContract.acceptanceDeadlineDays`, 7 j par défaut |
| `GET /api/cron/residual-refunds` | Rembourse au client le reliquat séquestré des missions terminées — « il ne doit jamais rester un argent fantôme dans la mission » | quotidien |

Exemple de planification (cron système) :
```
*/10 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.flexwork.bj/api/cron/contract-expirations
*/10 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.flexwork.bj/api/cron/devis-expirations
*/10 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.flexwork.bj/api/cron/gig-order-expirations
# Délai en JOURS : une passe quotidienne suffit. Un retard ne fait que prolonger le temps
# laissé au client pour se prononcer, jamais l'inverse.
0 3 * * *     curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.flexwork.bj/api/cron/tacit-acceptance
# Reliquats : jamais urgent, mais jamais acceptable qu'ils dorment indéfiniment.
30 3 * * *    curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://app.flexwork.bj/api/cron/residual-refunds
```

Chaque endpoint est **idempotent** (ne traite que ce qui n'a pas déjà été annulé/remboursé) —
un double déclenchement est sans effet.

---

## 7. Worker (files et tâches planifiées)

Un processus distinct du serveur web, `npm run worker` (`src/worker/`), même image, autre
commande. Plusieurs répliques sont possibles : tout ce qu'il traite est réclamé par bail
(`FOR UPDATE SKIP LOCKED`) ou protégé par une politique pg-boss.

### Boucle rapide (`WORKER_POLL_MS`, 1 s)

| Table | Rôle | Écrite par |
|---|---|---|
| `PspEscrowOperation` (`dispatchStatus`) | **Instructions PSP** à transmettre (versements, remboursements, gels) | la transaction métier |
| `PspInboundEvent` | **Webhooks PSP** reçus, corps brut + signature, à appliquer | `POST /api/webhooks/psp`, après vérification de la signature |
| `EmailOutbox` | **E-mails** de notification à remettre au SMTP | `notifyUser` (src/lib/notify.ts) |

Reprises avec délai croissant ; au-delà du maximum de tentatives, la ligne passe en échec
(`echec_envoi` / `echec`) et apparaît en ⚠️ sur l'écran admin « Queues ».

### Tâches planifiées (pg-boss, schéma `pgboss`, fuseau `WORKER_TZ` = Africa/Porto-Novo)

| Tâche | Fréquence | Effet |
|---|---|---|
| `psp-reconcile` | 5 min | Relit auprès du PSP les opérations transmises sans réponse depuis 15 min |
| `payables-retry` | 1 min | Reprend les versements de **présence** refusés (5 min, 30 min, 3 h) |
| `contract-expirations` / `devis-expirations` / `gig-order-expirations` | 10 min | Échéances (ex-crons système, §6) |
| `tacit-acceptance` | toutes les heures (h + 5) | Sélectionne en base les contrats **échus** et dépose **un job par contrat** |
| `residual-refunds` | 3 h 30 | Sélectionne les missions closes **qui gardent un solde** et dépose un job par contrat |
| `draft-attachments-cleanup` | 4 h 00 | Purge des pièces jointes de brouillons abandonnés |
| `emails-purge` | 4 h 30 | Supprime les e-mails envoyés depuis plus de 30 jours |
| `queues-health` | 5 min | État des files ; ouvre, rappelle et résout les **alertes** `queues.*` (§8.4) |
| `finance-check` | toutes les heures (h + 15) | Anomalies **critiques** du registre financier (règles d'or du séquestre) → alertes `finance.*` |
| `worker-heartbeats-prune` | 4 h 45 | Oublie les répliques disparues depuis plus d'un jour |

Les jobs par contrat (`tacit-acceptance-contract`, `residual-refund-contract`) sont consommés en
parallèle (`WORKER_ITEM_CONCURRENCY`, 4 par réplique), repris 3 fois en cas d'erreur, et
dédupliqués par contrat (politique `stately`) : jamais deux traitements simultanés du même
contrat. Un contrat en échec ne bloque plus les suivants.

### Mise en route

1. Variables : `QUEUE_MODE=worker` sur le serveur web **et** le worker ; même `DATABASE_URL`,
   même `ESCROW_WEBHOOK_SECRET`, mêmes identifiants SMTP. Option : `PGBOSS_DATABASE_URL` si
   pg-boss doit passer par une connexion directe (hors PgBouncer en mode transaction).
2. Migration : `npx prisma migrate deploy` (avant le web et le worker).
3. Lancer le worker à côté de `next start` :

```yaml
# docker-compose (extrait)
services:
  web:
    image: flexwork:latest
    command: npm run start
    environment: { QUEUE_MODE: worker }
  worker:
    image: flexwork:latest
    command: npm run worker
    environment: { QUEUE_MODE: worker }
    restart: unless-stopped
    stop_grace_period: 40s   # le worker termine son tour en cours sur SIGTERM
```

Sur un VPS sans conteneur : une unité systemd `flexwork-worker.service`
(`ExecStart=/usr/bin/npm run worker`, `Restart=always`, `KillSignal=SIGTERM`, `TimeoutStopSec=40`).
Supprimer alors les lignes cron du §6.

### Ce qui reste immédiat, même en mode `worker`

- Le **financement** (HOLD) : le client attend sa page de paiement.
- Le **code OTP** par e-mail : l'utilisateur l'attend pour se connecter (`src/lib/otp.ts`).

### Exploitation

- **Instruction abandonnée** (`dispatchStatus = echec_envoi`) : corriger la cause, puis
  `dispatchStatus = 'a_envoyer'`, `nextDispatchAt = now()`. Le PSP déduplique par `pspReference`.
- **Webhook en échec** (`PspInboundEvent.status = echec`) : lire `lastError`, corriger,
  `status = 'recu'`.
- **E-mail abandonné** (`EmailOutbox.status = echec`) : corriger le SMTP, `status = 'a_envoyer'`.
- L'état durable est dans les tables métier, pas dans pg-boss : vider le schéma `pgboss` ne perd ni
  paiement ni e-mail (les planifications se recréent au démarrage, les jobs par contrat à la
  sélection suivante).

---

## 8. Montée en charge (phase 3)

### 8.1 Compteur de rate-limit partagé (Redis)

Le middleware de Next 14 tourne sur le runtime **Edge** : pas de socket TCP, donc pas de client
Redis classique. Il parle à Redis par son **API REST** (protocole Upstash) :

- **Upstash** (géré) : copier l'URL REST et le jeton dans `RATE_LIMIT_REDIS_REST_URL` /
  `RATE_LIMIT_REDIS_REST_TOKEN`.
- **Redis auto-hébergé** : ajouter le relais `serverless-redis-http` (SRH), même protocole :

```yaml
  redis:
    image: redis:7-alpine
    command: redis-server --save "" --appendonly no   # compteurs éphémères : aucune persistance
  redis-http:
    image: hiett/serverless-redis-http:latest
    environment:
      SRH_MODE: env
      SRH_TOKEN: ${RATE_LIMIT_REDIS_REST_TOKEN}
      SRH_CONNECTION_STRING: redis://redis:6379
  web:
    environment:
      RATE_LIMIT_REDIS_REST_URL: http://redis-http:80
      RATE_LIMIT_REDIS_REST_TOKEN: ${RATE_LIMIT_REDIS_REST_TOKEN}
```

Première ligne de défense recommandée en plus : `limit_req` de nginx, qui coupe les abus avant
même Node :

```nginx
limit_req_zone $binary_remote_addr zone=flexwork:20m rate=10r/s;
server {
  location / {
    limit_req zone=flexwork burst=40 nodelay;
    proxy_set_header X-Forwarded-For $remote_addr;   # écrase, n'ajoute pas (§1)
    proxy_set_header X-Real-IP $remote_addr;
    proxy_pass http://web:3000;
  }
}
```

### 8.2 PgBouncer

Chaque instance Next et chaque worker ouvre son propre pool Prisma (par défaut
`nb_cpu × 2 + 1` connexions). Au-delà de quelques instances, Postgres sature
(`max_connections`). PgBouncer en **mode transaction** mutualise :

```yaml
  pgbouncer:
    image: edoburu/pgbouncer:latest
    environment:
      DATABASE_URL: postgresql://flexwork:${PG_PASSWORD}@db:5432/flexwork
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 1000
      DEFAULT_POOL_SIZE: 30
      AUTH_TYPE: scram-sha-256
```

| Variable | Valeur | Utilisée par |
|---|---|---|
| `DATABASE_URL` | `postgresql://…@pgbouncer:6432/flexwork?pgbouncer=true&connection_limit=10` | Prisma (web + worker) |
| `DIRECT_DATABASE_URL` | `postgresql://…@db:5432/flexwork` | migrations, pg-boss, `LISTEN` temps réel |

- `pgbouncer=true` : Prisma n'utilise plus d'instructions préparées (incompatibles avec le mode
  transaction). Les transactions interactives (`FOR UPDATE` des contrats) restent sûres : une
  transaction occupe une seule connexion serveur du début à la fin.
- `connection_limit` : taille du pool **par instance**. Total vu par PgBouncer =
  instances × `connection_limit`, à garder sous `MAX_CLIENT_CONN`.
- **Migrations** : `DATABASE_URL=$DIRECT_DATABASE_URL npx prisma migrate deploy`.
- Le worker avertit au démarrage si `pgbouncer=true` est présent sans `DIRECT_DATABASE_URL`.

### 8.3 Temps réel (SSE)

La cloche et les badges du tableau de bord ne sondent plus toutes les 30 s : une notification
publie un signal (`pg_notify`), chaque instance l'écoute (`LISTEN`, **une** connexion directe
par instance) et le relaie aux onglets de l'utilisateur par `GET /api/realtime/stream`
(Server-Sent Events). Les sondages passent à 5 min tant que le flux est ouvert, et reprennent
leur rythme s'il tombe. Le signal ne transporte aucune donnée : le navigateur relit ses
compteurs par les routes habituelles.

nginx doit laisser le flux ouvert et non tamponné :

```nginx
location /api/realtime/stream {
  proxy_pass http://web:3000;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_read_timeout 1h;   # le serveur envoie un battement toutes les 25 s
}
```

Option : `REALTIME_DATABASE_URL` si l'écoute doit passer par une autre connexion que
`DIRECT_DATABASE_URL`.

### 8.4 Alertes et supervision

- **Canaux** : `ALERT_WEBHOOK_URL` (Slack, Mattermost, Discord, Google Chat… — POST JSON
  `{ text, content }`) et/ou `ALERT_EMAILS` (liste séparée par des virgules, envoi SMTP direct).
  Sans canal, les alertes restent visibles sur l'écran admin « Queues » et dans les journaux.
- **Cycle** : une alerte s'ouvre à la première détection, se rappelle toutes les
  `ALERT_REPEAT_HOURS` (6 h) tant qu'elle dure, s'annonce résolue quand elle disparaît (table
  `OpsAlert`).
- **Sources** : files (instructions PSP abandonnées ou en retard, webhooks en échec, opérations
  sans réponse, e-mails abandonnés ou en retard) toutes les 5 min ; anomalies critiques du
  registre financier toutes les heures.
- **Worker arrêté** : il ne peut pas s'alerter lui-même. `GET /api/health` répond **503** quand
  `QUEUE_MODE=worker` et qu'aucune réplique n'a battu depuis 2 min (table `WorkerHeartbeat`), ou
  quand la base est injoignable. À brancher sur :
  - le healthcheck du conteneur web :
    `healthcheck: { test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"], interval: 30s }` ;
  - une supervision **externe** (UptimeRobot, Better Stack…) qui prévient quand la sonde échoue.

