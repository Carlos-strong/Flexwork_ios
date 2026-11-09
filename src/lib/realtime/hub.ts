import { Client } from "pg";
import { prisma } from "@/lib/db";
import { directDatabaseUrl } from "@/lib/db-urls";

// ---------------------------------------------------------------------------
// Temps réel (2026-10-01) — un événement par utilisateur, diffusé à toutes les instances.
//
// La cloche et les badges du tableau de bord interrogeaient le serveur toutes les 30 s, onglet
// ouvert ou non, qu'il se soit passé quelque chose ou non : 4 à 6 requêtes par utilisateur
// connecté et par demi-minute, la première charge de l'API à mesure que l'audience grandit.
//
// Désormais une notification PUBLIE un signal (`pg_notify`) ; chaque instance Next écoute le
// canal (`LISTEN`, une connexion par instance) et le relaie aux onglets de l'utilisateur concerné
// par Server-Sent Events (GET /api/realtime/stream). Le navigateur rafraîchit alors ses compteurs
// — le signal ne transporte aucune donnée, seulement « quelque chose a changé pour toi » : rien
// de sensible ne transite par le canal, et la limite de 8 Ko de NOTIFY n'est jamais en jeu.
//
// Postgres plutôt que Redis : déjà là, et NOTIFY est transactionnel — un signal émis dans une
// transaction annulée n'est jamais livré.
// ---------------------------------------------------------------------------

const CHANNEL = "flexwork_events";

export type RealtimeEvent = { kind: string };
type Listener = (event: RealtimeEvent) => void;

type HubState = {
  client: Client | null;
  connecting: Promise<void> | null;
  subscribers: Map<string, Set<Listener>>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

// Sur globalThis : le rechargement à chaud du développement ne doit pas ouvrir une connexion
// d'écoute de plus à chaque sauvegarde.
const globalHub = globalThis as unknown as { __flexworkRealtime?: HubState };
const hub: HubState = (globalHub.__flexworkRealtime ??= {
  client: null,
  connecting: null,
  subscribers: new Map(),
  reconnectTimer: null,
});

function dispatch(payload: string | undefined) {
  if (!payload) return;
  try {
    const { u, k } = JSON.parse(payload) as { u?: string; k?: string };
    if (!u || !k) return;
    for (const listener of hub.subscribers.get(u) ?? []) listener({ kind: k });
  } catch {
    // Charge illisible : ignorée, ce n'est qu'un signal de rafraîchissement.
  }
}

function scheduleReconnect() {
  if (hub.reconnectTimer || hub.subscribers.size === 0) return;
  hub.reconnectTimer = setTimeout(() => {
    hub.reconnectTimer = null;
    void ensureListening().catch(() => scheduleReconnect());
  }, 2_000);
}

async function ensureListening(): Promise<void> {
  if (hub.client) return;
  if (hub.connecting) return hub.connecting;
  hub.connecting = (async () => {
    const client = new Client({ connectionString: directDatabaseUrl(process.env.REALTIME_DATABASE_URL), application_name: "flexwork-realtime" });
    client.on("notification", (msg) => dispatch(msg.payload));
    const lost = (error?: Error) => {
      if (hub.client !== client) return;
      console.warn(`[realtime] écoute perdue${error ? ` : ${error.message}` : ""} — reconnexion`);
      hub.client = null;
      client.removeAllListeners();
      void client.end().catch(() => {});
      scheduleReconnect();
    };
    client.on("error", lost);
    client.on("end", () => lost());
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    hub.client = client;
  })().finally(() => {
    hub.connecting = null;
  });
  return hub.connecting;
}

/** Abonne `listener` aux signaux de `userId`. Renvoie la fonction de désabonnement. */
export async function subscribe(userId: string, listener: Listener): Promise<() => void> {
  const set = hub.subscribers.get(userId) ?? new Set<Listener>();
  set.add(listener);
  hub.subscribers.set(userId, set);
  try {
    await ensureListening();
  } catch (error) {
    console.warn(`[realtime] écoute impossible : ${(error as Error).message}`);
    scheduleReconnect();
  }
  return () => {
    set.delete(listener);
    if (set.size === 0) hub.subscribers.delete(userId);
  };
}

/**
 * Signale à `userId` que quelque chose a changé pour lui. Ne lève JAMAIS : le temps réel est un
 * confort — l'action métier qui l'a déclenché ne doit pas échouer parce qu'il est indisponible.
 */
export async function publishToUser(userId: string, kind: string): Promise<void> {
  try {
    const payload = JSON.stringify({ u: userId, k: kind.slice(0, 64) });
    await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
  } catch (error) {
    console.warn(`[realtime] publication impossible (${kind}) : ${(error as Error).message}`);
  }
}

/** Nombre d'onglets connectés sur CETTE instance — pour la supervision. */
export function localSubscriberCount(): number {
  let n = 0;
  for (const set of hub.subscribers.values()) n += set.size;
  return n;
}
