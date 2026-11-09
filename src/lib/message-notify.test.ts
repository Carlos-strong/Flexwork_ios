import { describe, expect, it, vi, beforeEach } from "vitest";

const { notificationCreate, notificationCount, notificationUpdateMany, userFindUnique, missionFindUnique, sendMail } = vi.hoisted(() => ({
  notificationCreate: vi.fn(),
  notificationCount: vi.fn(),
  notificationUpdateMany: vi.fn(),
  userFindUnique: vi.fn(),
  missionFindUnique: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    notification: { create: notificationCreate, count: notificationCount, updateMany: notificationUpdateMany },
    user: { findUnique: userFindUnique },
    mission: { findUnique: missionFindUnique },
  },
}));
vi.mock("@/lib/mail", () => ({ sendMail }));

import { notifyNewMessage, resolveCounterpart, markConversationNotificationsRead } from "./message-notify";

beforeEach(() => {
  notificationCreate.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: "n1", ...data }));
  notificationCount.mockReset().mockResolvedValue(0); // rien en attente => e-mail autorisé
  notificationUpdateMany.mockReset().mockResolvedValue({ count: 2 });
  userFindUnique.mockReset().mockResolvedValue({ firstname: "Awa", lastname: "Diop", email: "awa@flexwork.bj" });
  missionFindUnique.mockReset().mockResolvedValue({ titre: "Rénovation", clientId: "client", proposals: [{ providerId: "provider", status: "acceptee" }] });
  sendMail.mockReset().mockResolvedValue({ delivered: true });
});

describe("resolveCounterpart — même règle que la liste des conversations", () => {
  it("le client parle au prestataire dont la candidature est acceptée", async () => {
    missionFindUnique.mockResolvedValue({
      clientId: "client",
      proposals: [{ providerId: "autre", status: "envoyee" }, { providerId: "retenu", status: "acceptee" }],
    });
    expect(await resolveCounterpart("m1", "client")).toBe("retenu");
  });

  it("à défaut d'acceptée, le premier candidat", async () => {
    missionFindUnique.mockResolvedValue({
      clientId: "client",
      proposals: [{ providerId: "premier", status: "envoyee" }, { providerId: "second", status: "envoyee" }],
    });
    expect(await resolveCounterpart("m1", "client")).toBe("premier");
  });

  it("le prestataire parle au client de la mission", async () => {
    expect(await resolveCounterpart("m1", "provider")).toBe("client");
  });

  it("aucun interlocuteur tant que personne n'a candidaté", async () => {
    missionFindUnique.mockResolvedValue({ clientId: "client", proposals: [] });
    expect(await resolveCounterpart("m1", "client")).toBeNull();
  });
});

describe("notifyNewMessage — cloche + e-mail pour l'expéditeur ET le destinataire", () => {
  it("notifie les deux parties et envoie les deux e-mails au premier message", async () => {
    await notifyNewMessage({ missionId: "m1", senderId: "provider", preview: "Bonjour, je passe demain" });

    const types = notificationCreate.mock.calls.map((c) => c[0].data.type);
    expect(types).toEqual(expect.arrayContaining(["message_recu", "message_envoye"]));
    const targets = notificationCreate.mock.calls.map((c) => c[0].data.userId);
    expect(targets).toEqual(expect.arrayContaining(["client", "provider"]));
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("chaque notification est rattachée à la mission (pour marquer lu à l'ouverture du fil)", async () => {
    await notifyNewMessage({ missionId: "m1", senderId: "provider", preview: "Bonjour" });

    for (const call of notificationCreate.mock.calls) {
      expect(call[0].data.missionId).toBe("m1");
    }
  });

  it("un seul e-mail tant que le précédent n'est pas lu — le suivant n'alimente que la cloche", async () => {
    notificationCount.mockResolvedValue(1); // une notification de messagerie déjà non lue

    await notifyNewMessage({ missionId: "m1", senderId: "provider", preview: "Deuxième message" });

    expect(notificationCreate).toHaveBeenCalledTimes(2); // la cloche continue de recevoir
    expect(sendMail).not.toHaveBeenCalled(); // mais plus d'e-mail
  });

  it("une pièce jointe notifie comme un message, avec le nom du fichier", async () => {
    await notifyNewMessage({ missionId: "m1", senderId: "client", preview: "devis.pdf", isFile: true });

    const recu = notificationCreate.mock.calls.find((c) => c[0].data.type === "message_recu");
    expect(recu?.[0].data.message).toContain("devis.pdf");
  });

  it("sans interlocuteur, seul l'accusé d'envoi est créé", async () => {
    missionFindUnique.mockResolvedValue({ titre: "Rénovation", clientId: "client", proposals: [] });

    await notifyNewMessage({ missionId: "m1", senderId: "client", preview: "Personne en face" });

    const types = notificationCreate.mock.calls.map((c) => c[0].data.type);
    expect(types).toEqual(["message_envoye"]);
  });

  it("un aperçu très long est tronqué", async () => {
    await notifyNewMessage({ missionId: "m1", senderId: "provider", preview: "x".repeat(300) });

    const recu = notificationCreate.mock.calls.find((c) => c[0].data.type === "message_recu");
    expect(recu?.[0].data.message).toContain("…");
    expect(recu?.[0].data.message.length).toBeLessThan(300);
  });

  it("ne rejette jamais, même si la base tombe — l'envoi du message reste valide", async () => {
    missionFindUnique.mockRejectedValue(new Error("base indisponible"));

    await expect(notifyNewMessage({ missionId: "m1", senderId: "provider", preview: "test" })).resolves.toBeUndefined();
  });
});

describe("markConversationNotificationsRead — réarme l'e-mail du message suivant", () => {
  it("marque lues les notifications de messagerie de cette conversation", async () => {
    await markConversationNotificationsRead("client", "m1");

    const where = notificationUpdateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: "client", missionId: "m1", readAt: null });
    expect(where.type.in).toEqual(["message_recu", "message_envoye"]);
  });
});
