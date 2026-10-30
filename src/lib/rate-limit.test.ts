import { describe, expect, it, vi } from "vitest";
import { isAllowed, memoryStore, RATE_WINDOW_MS, redisRestStore, storeFromEnv } from "./rate-limit";

// Faux serveur Redis REST (protocole Upstash) : un INCR + PEXPIRE par appel de pipeline.
function fakeRedis() {
  const data = new Map<string, number>();
  const calls: unknown[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    const commands = JSON.parse(String(init.body)) as string[][];
    calls.push(commands);
    const [, key] = commands[0];
    data.set(key, (data.get(key) ?? 0) + 1);
    return new Response(JSON.stringify([{ result: data.get(key) }, { result: 1 }]), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, data };
}

describe("limitation de débit partagée", () => {
  it("mémoire : compte dans la fenêtre, repart à zéro à la suivante", async () => {
    const store = memoryStore();
    const t = 1_000_000;
    expect(await store.hit("ip:a", t)).toBe(1);
    expect(await store.hit("ip:a", t + 10)).toBe(2);
    expect(await store.hit("ip:b", t + 10)).toBe(1);
    expect(await store.hit("ip:a", t + RATE_WINDOW_MS + 1)).toBe(1);
  });

  it("Redis REST : deux instances partagent le même compteur", async () => {
    const redis = fakeRedis();
    const instanceA = redisRestStore({ url: "https://redis.test/", token: "t", fallback: memoryStore(), fetchImpl: redis.fetchImpl });
    const instanceB = redisRestStore({ url: "https://redis.test", token: "t", fallback: memoryStore(), fetchImpl: redis.fetchImpl });
    const now = 5 * RATE_WINDOW_MS;
    expect(await isAllowed(instanceA, "ip:x", 2, now)).toBe(true);
    expect(await isAllowed(instanceB, "ip:x", 2, now)).toBe(true);
    // Troisième requête, sur l'une ou l'autre instance : refusée — ce que la Map locale ratait.
    expect(await isAllowed(instanceA, "ip:x", 2, now)).toBe(false);
    expect(redis.calls[0]).toEqual([
      ["INCR", "rl:ip:x:5"],
      ["PEXPIRE", "rl:ip:x:5", String(RATE_WINDOW_MS)],
    ]);
  });

  it("Redis indisponible : le compteur local prend le relais, la limite tient toujours", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const store = redisRestStore({ url: "https://redis.test", token: "t", fallback: memoryStore(), fetchImpl: failing });
    const now = 7 * RATE_WINDOW_MS;
    expect(await isAllowed(store, "ip:y", 1, now)).toBe(true);
    expect(await isAllowed(store, "ip:y", 1, now)).toBe(false);
    // Un seul avertissement malgré deux échecs dans la même minute.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("réponse d'erreur Redis : traitée comme une panne", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorBody = vi.fn(async () => new Response(JSON.stringify([{ error: "WRONGPASS" }]), { status: 200 })) as unknown as typeof fetch;
    const store = redisRestStore({ url: "https://redis.test", token: "t", fallback: memoryStore(), fetchImpl: errorBody });
    expect(await store.hit("ip:z", 0)).toBe(1);
  });

  it("choix du magasin par l'environnement", () => {
    expect(storeFromEnv({}).name).toBe("memory");
    expect(storeFromEnv({ RATE_LIMIT_REDIS_REST_URL: "https://r", RATE_LIMIT_REDIS_REST_TOKEN: "t" }).name).toBe("redis-rest");
    expect(storeFromEnv({ RATE_LIMIT_REDIS_REST_URL: "https://r" }).name).toBe("memory");
  });
});
