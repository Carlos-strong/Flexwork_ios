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

## 2. Le compteur de rate-limit du middleware est EN MÉMOIRE

`src/middleware.ts` garde ses buckets dans une `Map` en mémoire du process :

- **Survie** : ne survit ni au redémarrage ni à la mise à l'échelle horizontale.
- **1 instance unique** : OK tel quel.
- **Plusieurs instances** : remplacer par un magasin partagé (Redis / Upstash) avant d'en
  dépendre — sinon chaque instance a son propre compteur et les limites effectives sont
  divisées par le nombre d'instances (ou contournées en répartissant les requêtes).

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
- [ ] Nombre d'instances Next = 1, **ou** store partagé (Redis/Upstash) branché sur le
      compteur du middleware.
- [ ] Envoi d'emails réel configuré (`src/lib/mail.ts`) — Mailpit est réservé au dev.
- [ ] OTP : provider SMS réel branché en prod (l'envoi est stubbé en dev, voir `src/lib/otp.ts`).

---

## 6. Crons à planifier (expirations temporelles)

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
