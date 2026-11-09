-- Alertes d'exploitation et battement du worker.
CREATE TABLE "OpsAlert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastNotifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "OpsAlert_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OpsAlert_key_key" ON "OpsAlert"("key");
CREATE INDEX "OpsAlert_resolvedAt_idx" ON "OpsAlert"("resolvedAt");

CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkerHeartbeat_lastSeenAt_idx" ON "WorkerHeartbeat"("lastSeenAt");
