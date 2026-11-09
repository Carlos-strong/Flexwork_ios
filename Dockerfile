# Image unique pour le web (`next start`) et le worker (`npm run worker`) — même code, autre
# commande, comme le prévoit DEPLOYMENT-PRODUCTION.md §7.
#
# Les dépendances de développement restent dans l'image : le worker tourne sous `tsx`
# (src/worker/index.ts n'est pas compilé) et `prisma migrate deploy` a besoin de la CLI.

FROM node:20-bookworm-slim AS base
# openssl : requis par le moteur de requêtes Prisma. ca-certificates : SMTP/PSP en TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund \
 && npx prisma generate

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Les variables NEXT_PUBLIC_* sont figées dans le JS client AU BUILD : les changer
# impose de reconstruire l'image, pas seulement de redémarrer.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_ACADEMY_URL=""
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV \
    NEXT_PUBLIC_ACADEMY_URL=$NEXT_PUBLIC_ACADEMY_URL \
    NEXT_TELEMETRY_DISABLED=1
# Le build importe des modules qui lisent l'environnement (src/auth.ts refuse le secret
# placeholder) : valeurs factices, jamais utilisées à l'exécution.
RUN AUTH_SECRET=build-only-not-used-at-runtime \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    npm run build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app ./
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
