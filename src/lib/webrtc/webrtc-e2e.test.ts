/**
 * Tests d'intégration et E2E de la communication WebRTC.
 *
 * Simule le flux complet client ↔ prestataire :
 *   1. Connexion SSE des deux utilisateurs
 *   2. Client POST /api/webrtc/signal (offer) → Prestataire reçoit via SSE
 *   3. Prestataire POST /api/webrtc/signal (answer) → Client reçoit via SSE
 *   4. Échange de candidats ICE
 *   5. Hangup → notification de fin d'appel
 *   6. Erreurs : non-auth, payload invalide
 *
 * PARTIE 1 : Tests d'intégration API (POST/GET avec mock auth)
 * PARTIE 2 : Tests E2E sur le store de signalisation directement
 *   (le store est le cœur du routage ; les API ne sont que des wrappers auth)
 *
 * Mock de auth() pour simuler des utilisateurs différents.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock auth() — on mocke AVANT d'importer les routes
// ---------------------------------------------------------------------------
const mockGetSession = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => mockGetSession(),
}));

// F-03 (fermeture de la faille d'appel vers n'importe qui) : POST /api/webrtc/signal exige
// désormais qu'une mission lie réellement l'émetteur au destinataire
// (src/app/api/webrtc/signal/route.ts). Ces tests d'intégration sont hermétiques (pas de
// base) : on mocke le garde pour qu'il réponde « mission liée » sur les cas valides.
// `vi.hoisted` est requis : la factory de `vi.mock` est remontée en tête de fichier.
const { missionFindFirst } = vi.hoisted(() => ({
  missionFindFirst: vi.fn().mockResolvedValue({ id: "m-linked" }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mission: { findFirst: missionFindFirst },
  },
}));

// ---------------------------------------------------------------------------
// Imports post-mock
// ---------------------------------------------------------------------------
import { POST as signalPost } from "@/app/api/webrtc/signal/route";
import { GET as eventsGet } from "@/app/api/webrtc/events/route";
import {
  addSSEClient,
  removeSSEClient,
  sendToUser,
  notifyUser,
} from "@/lib/webrtc/signaling";
import type { SignalMessage } from "@/lib/webrtc/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Crée une requête POST simulée */
function postReq(body: unknown): Request {
  return new Request("http://localhost/api/webrtc/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Mock de session auth */
function mockSession(userId: string) {
  mockGetSession.mockResolvedValue({
    user: { id: userId, email: `${userId}@test.com`, role: "client" },
  });
}

/** Crée un mock ReadableStreamDefaultController avec buffer d'inspection */
function mockController(): ReadableStreamDefaultController & { _chunks: string[] } {
  const chunks: string[] = [];
  return {
    enqueue: (chunk: Uint8Array) => { chunks.push(new TextDecoder().decode(chunk)); },
    close: () => {},
    error: () => {},
    desiredSize: 1,
    _chunks: chunks,
  } as unknown as ReadableStreamDefaultController & { _chunks: string[] };
}

/** Extrait le payload JSON d'un chunk SSE "data: {...}" */
function parseSSEData(chunk: string): SignalMessage {
  const prefix = "data: ";
  if (chunk.startsWith(prefix)) return JSON.parse(chunk.slice(prefix.length));
  return JSON.parse(chunk);
}

// ---------------------------------------------------------------------------
// Tests d'intégration API
// ---------------------------------------------------------------------------

describe("WebRTC Signaling — Intégration API", () => {
  describe("POST /api/webrtc/signal", () => {
    it("rejette un utilisateur non authentifié (401)", async () => {
      mockGetSession.mockResolvedValue(null);
      const res = await signalPost(postReq({ to: "x", type: "offer", payload: {} }));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("unauthenticated");
    });

    it("rejette un payload invalide (400)", async () => {
      mockSession("client-1");
      const res = await signalPost(postReq({ to: "", type: "invalid", payload: null }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_payload");
    });

    it("rejette un body JSON malformé (400)", async () => {
      mockSession("client-1");
      const req = new Request("http://localhost/api/webrtc/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      const res = await signalPost(req);
      expect(res.status).toBe(400);
    });

    it("accepte un signal valide et le route (200)", async () => {
      mockSession("client-1");
      const res = await signalPost(
        postReq({ to: "presta-1", type: "offer", payload: { sdp: "test" } })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("accepte les 4 types de signaux (offer, answer, ice-candidate, hangup)", async () => {
      const types = ["offer", "answer", "ice-candidate", "hangup"] as const;
      for (const type of types) {
        mockSession("sender");
        const res = await signalPost(
          postReq({
            to: "receiver",
            type,
            payload: type === "ice-candidate"
              ? { candidate: "candidate:...", sdpMLineIndex: 0, sdpMid: "0" }
              : type === "hangup"
              ? null
              : { sdp: "v=0", type },
          })
        );
        expect(res.status).toBe(200);
      }
    });

    it("le signal POST est bien relayé au destinataire SSE", async () => {
      // Vérification bout-en-bout : POST → store → contrôleur SSE
      const prestaCtrl = mockController();
      addSSEClient("presta-e2e", prestaCtrl);

      mockSession("client-e2e");
      const res = await signalPost(
        postReq({
          to: "presta-e2e",
          type: "offer",
          payload: { sdp: "v=0\r\noffer-sdp", type: "offer" },
        })
      );
      expect(res.status).toBe(200);

      // Le contrôleur SSE du prestataire a reçu le signal
      expect(prestaCtrl._chunks.length).toBe(1);
      const msg = parseSSEData(prestaCtrl._chunks[0]);
      expect(msg.type).toBe("offer");
      expect(msg.from).toBe("client-e2e");
      expect(msg.to).toBe("presta-e2e");
      expect((msg.payload as { sdp: string }).sdp).toBe("v=0\r\noffer-sdp");

      removeSSEClient("presta-e2e", prestaCtrl);
    });
  });

  describe("GET /api/webrtc/events", () => {
    it("rejette un utilisateur non authentifié (401)", async () => {
      mockGetSession.mockResolvedValue(null);
      const res = await eventsGet();
      expect(res.status).toBe(401);
    });

    it("renvoie un stream SSE avec Content-Type correct", async () => {
      mockSession("sse-user");
      const res = await eventsGet();
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/event-stream");
      expect(res.headers.get("Cache-Control")).toContain("no-cache");
    });

    it("envoie un ping 'connected' initial avec le userId", async () => {
      mockSession("ping-user");
      const res = await eventsGet();
      expect(res.status).toBe(200);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const { value } = await reader.read();
      reader.cancel();

      const text = decoder.decode(value);
      expect(text).toContain("connected");
      expect(text).toContain("ping-user");
    });

    it("le stream reste ouvert (ne se ferme pas prématurément)", async () => {
      mockSession("long-lived");
      const res = await eventsGet();
      expect(res.body).not.toBeNull();

      const reader = res.body!.getReader();
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      expect(value).toBeDefined();

      reader.cancel();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests E2E — Flux complet sur le store de signalisation
// ---------------------------------------------------------------------------

describe("WebRTC Signaling — E2E Client ↔ Prestataire (store direct)", () => {
  // Nettoie les clients SSE entre les tests
  beforeEach(() => {
    // On ne peut pas vider la Map interne, donc on utilise des userId
    // uniques par test pour garantir l'isolation.
  });

  it("flux complet : offer → answer → ice → hangup", () => {
    // Alice (cliente) et Bob (prestataire) ont chacun un contrôleur SSE
    const aliceCtrl = mockController();
    const bobCtrl = mockController();
    addSSEClient("alice", aliceCtrl);
    addSSEClient("bob", bobCtrl);

    // ---- 1. Alice envoie une offre à Bob ----
    sendToUser("bob", {
      type: "offer",
      from: "alice",
      to: "bob",
      payload: { sdp: "v=0\r\nalice-offer-sdp", type: "offer" },
      timestamp: 1000,
    });

    // Bob reçoit l'offre
    expect(bobCtrl._chunks.length).toBe(1);
    const offerMsg = parseSSEData(bobCtrl._chunks[0]);
    expect(offerMsg.type).toBe("offer");
    expect(offerMsg.from).toBe("alice");
    expect((offerMsg.payload as { sdp: string }).sdp).toContain("alice-offer-sdp");

    // Alice ne reçoit rien (pas de fuite vers l'émetteur)
    expect(aliceCtrl._chunks.length).toBe(0);

    // ---- 2. Bob répond avec une answer ----
    sendToUser("alice", {
      type: "answer",
      from: "bob",
      to: "alice",
      payload: { sdp: "v=0\r\nbob-answer-sdp", type: "answer" },
      timestamp: 2000,
    });

    // Alice reçoit la réponse
    expect(aliceCtrl._chunks.length).toBe(1);
    const answerMsg = parseSSEData(aliceCtrl._chunks[0]);
    expect(answerMsg.type).toBe("answer");
    expect(answerMsg.from).toBe("bob");
    expect((answerMsg.payload as { sdp: string }).sdp).toContain("bob-answer-sdp");

    // ---- 3. Échange ICE candidates ----
    // Reset counters
    aliceCtrl._chunks.length = 0;
    bobCtrl._chunks.length = 0;

    sendToUser("bob", {
      type: "ice-candidate",
      from: "alice",
      to: "bob",
      payload: { candidate: "candidate:1 1 UDP 2130706431 192.168.1.1 12345 typ host", sdpMLineIndex: 0, sdpMid: "0" },
      timestamp: 3000,
    });

    expect(bobCtrl._chunks.length).toBe(1);
    const iceToBob = parseSSEData(bobCtrl._chunks[0]);
    expect(iceToBob.type).toBe("ice-candidate");
    expect((iceToBob.payload as { candidate: string }).candidate).toContain("192.168.1.1");

    sendToUser("alice", {
      type: "ice-candidate",
      from: "bob",
      to: "alice",
      payload: { candidate: "candidate:2 1 UDP 2130706431 10.0.0.2 54321 typ host", sdpMLineIndex: 0, sdpMid: "0" },
      timestamp: 4000,
    });

    expect(aliceCtrl._chunks.length).toBe(1);
    const iceToAlice = parseSSEData(aliceCtrl._chunks[0]);
    expect(iceToAlice.type).toBe("ice-candidate");
    expect((iceToAlice.payload as { candidate: string }).candidate).toContain("10.0.0.2");

    // ---- 4. Alice raccroche ----
    aliceCtrl._chunks.length = 0;
    bobCtrl._chunks.length = 0;

    sendToUser("bob", {
      type: "hangup",
      from: "alice",
      to: "bob",
      payload: null,
      timestamp: 5000,
    });

    expect(bobCtrl._chunks.length).toBe(1);
    const hangupMsg = parseSSEData(bobCtrl._chunks[0]);
    expect(hangupMsg.type).toBe("hangup");
    expect(hangupMsg.from).toBe("alice");

    // Alice ne reçoit pas le hangup (c'est elle qui l'a envoyé)
    expect(aliceCtrl._chunks.length).toBe(0);

    // Nettoyage
    removeSSEClient("alice", aliceCtrl);
    removeSSEClient("bob", bobCtrl);
  });

  it("les signaux ne fuient pas entre paires d'utilisateurs", () => {
    // Alice ↔ Bob (paire 1), Carol ↔ Dave (paire 2)
    const alice = mockController();
    const bob = mockController();
    const carol = mockController();
    const dave = mockController();

    addSSEClient("alice", alice);
    addSSEClient("bob", bob);
    addSSEClient("carol", carol);
    addSSEClient("dave", dave);

    // Alice envoie à Bob UNIQUEMENT
    sendToUser("bob", {
      type: "offer",
      from: "alice",
      to: "bob",
      payload: { sdp: "secret-alice-bob", type: "offer" },
      timestamp: 1,
    });

    // Seul Bob reçoit
    expect(bob._chunks.length).toBe(1);
    expect(parseSSEData(bob._chunks[0]).payload).toEqual({ sdp: "secret-alice-bob", type: "offer" });

    // Les autres ne reçoivent RIEN
    expect(alice._chunks.length).toBe(0);
    expect(carol._chunks.length).toBe(0);
    expect(dave._chunks.length).toBe(0);

    // Carol envoie à Dave
    sendToUser("dave", {
      type: "answer",
      from: "carol",
      to: "dave",
      payload: { sdp: "carol-dave", type: "answer" },
      timestamp: 2,
    });

    // Seul Dave reçoit
    expect(dave._chunks.length).toBe(1);
    expect((parseSSEData(dave._chunks[0]).payload as { sdp: string }).sdp).toBe("carol-dave");

    // Bob n'a pas reçu de deuxième message (pas de fuite de Carol→Dave vers Bob)
    expect(bob._chunks.length).toBe(1);

    // Nettoyage
    removeSSEClient("alice", alice);
    removeSSEClient("bob", bob);
    removeSSEClient("carol", carol);
    removeSSEClient("dave", dave);
  });

  it("flux bidirectionnel complet avec notifyUser pour messages texte", () => {
    // Teste aussi notifyUser (utilisé pour les notifications de chat)
    const client = mockController();
    const presta = mockController();
    addSSEClient("client", client);
    addSSEClient("presta", presta);

    // Signal WebRTC classique
    sendToUser("presta", {
      type: "offer",
      from: "client",
      to: "presta",
      payload: { sdp: "offer", type: "offer" },
      timestamp: 1,
    });
    expect(presta._chunks.length).toBe(1);

    // Notification de nouveau message (event nommé)
    notifyUser("presta", "new-message", {
      conversationId: "conv-1",
      from: "client",
      text: "Bonjour, je suis intéressé par votre profil !",
    });

    expect(presta._chunks.length).toBe(2);
    const notifChunk = presta._chunks[1];
    expect(notifChunk).toContain("event: new-message");
    expect(notifChunk).toContain("Bonjour");

    // Le prestataire répond
    sendToUser("client", {
      type: "answer",
      from: "presta",
      to: "client",
      payload: { sdp: "answer", type: "answer" },
      timestamp: 2,
    });
    expect(client._chunks.length).toBe(1);

    notifyUser("client", "new-message", {
      conversationId: "conv-1",
      from: "presta",
      text: "Merci ! Voici mon portfolio.",
    });
    expect(client._chunks.length).toBe(2);

    removeSSEClient("client", client);
    removeSSEClient("presta", presta);
  });

  it("gère 10 paires simultanées sans interférence", () => {
    const pairs: { client: ReturnType<typeof mockController>; presta: ReturnType<typeof mockController> }[] = [];

    // Créer 10 paires
    for (let i = 0; i < 10; i++) {
      const c = mockController();
      const p = mockController();
      addSSEClient(`client-${i}`, c);
      addSSEClient(`presta-${i}`, p);
      pairs.push({ client: c, presta: p });
    }

    // Chaque client envoie une offre à son prestataire
    for (let i = 0; i < 10; i++) {
      sendToUser(`presta-${i}`, {
        type: "offer",
        from: `client-${i}`,
        to: `presta-${i}`,
        payload: { sdp: `offer-${i}`, type: "offer" },
        timestamp: i,
      });
    }

    // Vérifier que chaque prestataire a reçu exactement 1 message
    for (let i = 0; i < 10; i++) {
      expect(pairs[i].presta._chunks.length).toBe(1);
      const msg = parseSSEData(pairs[i].presta._chunks[0]);
      expect(msg.from).toBe(`client-${i}`);
      expect((msg.payload as { sdp: string }).sdp).toBe(`offer-${i}`);
    }

    // Vérifier qu'aucun client n'a reçu de message (pas de fuite)
    for (let i = 0; i < 10; i++) {
      expect(pairs[i].client._chunks.length).toBe(0);
    }

    // Nettoyage
    for (let i = 0; i < 10; i++) {
      removeSSEClient(`client-${i}`, pairs[i].client);
      removeSSEClient(`presta-${i}`, pairs[i].presta);
    }
  });
});
