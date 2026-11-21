/**
 * Test d'intégration : vérifie que la messagerie et les appels fonctionnent
 * entre le client et CHAQUE type de prestataire.
 *
 * Utilise les données seedées par scripts/seed-messaging-test.ts.
 * Mock auth() pour simuler chaque utilisateur.
 */

import { describe, expect, it, vi, beforeAll } from "vitest";

// ---- Mock auth ----
const mockSession = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockSession() }));

// ---- Seed user IDs (doivent correspondre à la seed) ----
// Récupérés dynamiquement via Prisma
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let USER_IDS: Record<string, string> = {};
let MISSION_IDS: string[] = [];

beforeAll(async () => {
  // Sélection par EMAIL EXACT de la seed (scripts/seed-messaging-test.ts), et non par
  // `contains: "flexwork.test"` : d'autres fichiers de test (contract-signature-workflow,
  // security-guards.route) créent aussi des users *@flexwork.test et écraseraient les IDs
  // seedés — le garde F-03 (signal lié à une mission) renvoyait alors 403 à tort.
  const SEED_EMAILS = [
    "aicha@flexwork.test",
    "expert-digital@flexwork.test",
    "expert-btp@flexwork.test",
    "artisan@flexwork.test",
    "manoeuvre@flexwork.test",
  ];
  const users = await prisma.user.findMany({
    where: { email: { in: SEED_EMAILS } },
    select: { id: true, email: true, role: true },
  });

  for (const u of users) {
    const key = u.role === "expert_btp_autres" ? "expert_btp" : u.role;
    USER_IDS[key] = u.id;
    // Also store the email-based key for clarity
    if (u.email.includes("expert-btp")) USER_IDS["expert_btp"] = u.id;
  }

  // Récupérer les missions de test
  const missions = await prisma.mission.findMany({
    where: { id: { startsWith: "test-msg-" } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  MISSION_IDS = missions.map((m) => m.id);

  console.log("Users found:", Object.keys(USER_IDS).length);
  console.log("Missions found:", MISSION_IDS.length);
});

function setUser(userId: string, role = "client") {
  mockSession.mockResolvedValue({
    user: { id: userId, email: `${role}@test.com`, role },
  });
}

// ---- Imports post-mock ----
import { GET as messagesGet, POST as messagesPost } from "@/app/api/messages/route";
import { POST as signalPost } from "@/app/api/webrtc/signal/route";

function req(method: "GET" | "POST", url: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

// =============================================================================
// TESTS
// =============================================================================

describe("Messagerie — Client ↔ Prestataires", () => {
  it("le client voit 4 conversations (une par type de prestataire)", async () => {
    setUser(USER_IDS["client"]);

    const res = await messagesGet(req("GET", "/api/messages"));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.conversations).toBeDefined();
    expect(data.conversations.length).toBeGreaterThanOrEqual(1);

    // Vérifier que chaque type de prestataire est représenté
    const roles = data.conversations.map(
      (c: Record<string, unknown>) => (c.interlocutor as Record<string, unknown>)?.role
    );
    console.log("Conversations interlocutor roles:", roles);

    // On doit avoir au moins 4 conversations (une par prestataire)
    expect(data.conversations.length).toBeGreaterThanOrEqual(4);
  });

  it("charge les messages d'une conversation client↔expert_digital", async () => {
    setUser(USER_IDS["client"]);

    const res = await messagesGet(
      req("GET", `/api/messages?missionId=${MISSION_IDS[0]}`)
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.messages).toBeDefined();
    expect(data.messages.length).toBeGreaterThanOrEqual(2);

    // Vérifier qu'il y a des messages envoyés et reçus
    const sent = data.messages.filter((m: Record<string, unknown>) => m.sent);
    const received = data.messages.filter((m: Record<string, unknown>) => !m.sent);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(received.length).toBeGreaterThanOrEqual(1);
  });

  it("charge les messages d'une conversation client↔expert_btp", async () => {
    setUser(USER_IDS["client"]);

    const res = await messagesGet(
      req("GET", `/api/messages?missionId=${MISSION_IDS[1]}`)
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.messages.length).toBeGreaterThanOrEqual(1);
  });

  it("charge les messages d'une conversation client↔artisan", async () => {
    setUser(USER_IDS["client"]);

    const res = await messagesGet(
      req("GET", `/api/messages?missionId=${MISSION_IDS[2]}`)
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.messages.length).toBeGreaterThanOrEqual(1);
  });

  it("charge les messages d'une conversation client↔manoeuvre", async () => {
    setUser(USER_IDS["client"]);

    const res = await messagesGet(
      req("GET", `/api/messages?missionId=${MISSION_IDS[3]}`)
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.messages.length).toBeGreaterThanOrEqual(1);
  });

  it("envoie un nouveau message et le retrouve", async () => {
    setUser(USER_IDS["client"]);

    // Envoyer
    const sendRes = await messagesPost(
      req("POST", "/api/messages", {
        missionId: MISSION_IDS[0],
        content: "Test message de vérification audio/vidéo — prêt pour l'appel ?",
      })
    );
    expect(sendRes.status).toBe(200);
    const sent = await sendRes.json();
    expect(sent.message).toBeDefined();
    expect(sent.message.content).toContain("audio/vidéo");

    // Relire les messages
    const getRes = await messagesGet(
      req("GET", `/api/messages?missionId=${MISSION_IDS[0]}`)
    );
    const data = await getRes.json();
    const lastMsg = data.messages[data.messages.length - 1];
    expect(lastMsg.content).toContain("audio/vidéo");
    expect(lastMsg.sent).toBe(true);
  });

  it("le prestataire (expert_digital) voit la conversation avec le client", async () => {
    setUser(USER_IDS["expert_digital"], "expert_digital");

    const res = await messagesGet(req("GET", "/api/messages"));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.conversations.length).toBeGreaterThanOrEqual(1);

    // L'interlocuteur doit être le client
    const interlocutor = data.conversations[0].interlocutor;
    expect(interlocutor.role).toBe("client");
  });
});

describe("WebRTC Signaling — Client ↔ Chaque prestataire", () => {
  it("le client peut envoyer un signal offer à l'expert_digital", async () => {
    setUser(USER_IDS["client"]);

    const res = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["expert_digital"],
        type: "offer",
        payload: { sdp: "v=0\r\ntest-offer-digital", type: "offer" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("le client peut envoyer un signal offer à l'expert_btp", async () => {
    setUser(USER_IDS["client"]);

    const res = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["expert_btp"],
        type: "offer",
        payload: { sdp: "v=0\r\ntest-offer-btp", type: "offer" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("le client peut envoyer un signal offer à l'artisan", async () => {
    setUser(USER_IDS["client"]);

    const res = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["artisan"],
        type: "offer",
        payload: { sdp: "v=0\r\ntest-offer-artisan", type: "offer" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("le client peut envoyer un signal offer au manoeuvre", async () => {
    setUser(USER_IDS["client"]);

    const res = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["manoeuvre"],
        type: "offer",
        payload: { sdp: "v=0\r\ntest-offer-manoeuvre", type: "offer" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("le prestataire peut répondre avec un answer", async () => {
    setUser(USER_IDS["expert_digital"], "expert_digital");

    const res = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["client"],
        type: "answer",
        payload: { sdp: "v=0\r\ntest-answer-digital", type: "answer" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("les ICE candidates circulent dans les deux sens", async () => {
    // Client → Prestataire
    setUser(USER_IDS["client"]);
    const ice1 = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["artisan"],
        type: "ice-candidate",
        payload: { candidate: "candidate:1 1 UDP 2130706431 192.168.1.100 44444 typ host", sdpMLineIndex: 0, sdpMid: "0" },
      })
    );
    expect(ice1.status).toBe(200);

    // Prestataire → Client
    setUser(USER_IDS["artisan"], "artisan");
    const ice2 = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["client"],
        type: "ice-candidate",
        payload: { candidate: "candidate:2 1 UDP 2130706431 10.0.0.50 55555 typ host", sdpMLineIndex: 0, sdpMid: "0" },
      })
    );
    expect(ice2.status).toBe(200);
  });

  it("le hangup termine l'appel proprement", async () => {
    setUser(USER_IDS["client"]);

    const res = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["manoeuvre"],
        type: "hangup",
        payload: null,
      })
    );
    expect(res.status).toBe(200);
  });

  it("flux complet client→expert_digital : offer → answer → ice → hangup", async () => {
    // 1. Client envoie offer
    setUser(USER_IDS["client"]);
    const offer = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["expert_digital"],
        type: "offer",
        payload: { sdp: "full-flow-offer", type: "offer" },
      })
    );
    expect(offer.status).toBe(200);

    // 2. Expert Digital répond
    setUser(USER_IDS["expert_digital"], "expert_digital");
    const answer = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["client"],
        type: "answer",
        payload: { sdp: "full-flow-answer", type: "answer" },
      })
    );
    expect(answer.status).toBe(200);

    // 3. ICE
    setUser(USER_IDS["client"]);
    const ice = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["expert_digital"],
        type: "ice-candidate",
        payload: { candidate: "candidate:full 1 UDP 2130706431 1.2.3.4 12345 typ host", sdpMLineIndex: 0, sdpMid: "0" },
      })
    );
    expect(ice.status).toBe(200);

    // 4. Hangup
    setUser(USER_IDS["client"]);
    const hangup = await signalPost(
      req("POST", "/api/webrtc/signal", {
        to: USER_IDS["expert_digital"],
        type: "hangup",
        payload: null,
      })
    );
    expect(hangup.status).toBe(200);
  });
});
