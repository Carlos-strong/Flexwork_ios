import { describe, expect, it, vi, beforeEach } from "vitest";

const { notificationCreate, userFindUnique, sendMail } = vi.hoisted(() => ({
  notificationCreate: vi.fn(),
  userFindUnique: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    notification: { create: notificationCreate },
    user: { findUnique: userFindUnique },
  },
}));
vi.mock("@/lib/mail", () => ({ sendMail }));

import { notifyUser, notifyBoth } from "./notify";

beforeEach(() => {
  notificationCreate.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: "n1", ...data }));
  userFindUnique.mockReset().mockResolvedValue({ email: "dest@flexwork.bj" });
  sendMail.mockReset().mockResolvedValue({ delivered: true });
});

describe("notifyUser — cloche du navbar + e-mail sur le même événement (2026-09-09)", () => {
  it("crée la notification in-app ET envoie l'e-mail", async () => {
    await notifyUser({ userId: "u1", type: "contract_locked", message: "Mission engagée", missionId: "m1" });

    expect(notificationCreate).toHaveBeenCalledWith({
      data: { userId: "u1", type: "contract_locked", message: "Mission engagée", missionId: "m1" },
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe("dest@flexwork.bj");
  });

  it("génère un e-mail par défaut depuis le libellé quand l'appelant n'en fournit pas", async () => {
    await notifyUser({ userId: "u1", type: "deliverable_validated", message: "Livrable validé" });

    expect(sendMail.mock.calls[0][0].subject).toBe("Flexwork — Livrable validé");
    expect(sendMail.mock.calls[0][0].text).toBe("Livrable validé");
  });

  it("respecte le gabarit fourni par l'appelant", async () => {
    await notifyUser({ userId: "u1", type: "kyc_verifie", message: "ok", email: { subject: "Sujet propre", text: "Corps" } });

    expect(sendMail.mock.calls[0][0].subject).toBe("Sujet propre");
  });

  it("email:false n'envoie aucun e-mail mais alimente quand même la cloche (anti-spam messagerie)", async () => {
    await notifyUser({ userId: "u1", type: "message_recu", message: "Nouveau message", missionId: "m1", email: false });

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("un échec d'e-mail ne fait pas échouer la notification in-app", async () => {
    sendMail.mockRejectedValue(new Error("SMTP down"));

    await expect(notifyUser({ userId: "u1", type: "kyc_rejete", message: "rejet" })).resolves.toBeTruthy();
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });

  it("missionId absent est stocké à null (événement de compte, ex. KYC)", async () => {
    await notifyUser({ userId: "u1", type: "kyc_verifie", message: "ok" });

    expect(notificationCreate.mock.calls[0][0].data.missionId).toBeNull();
  });
});

describe("notifyBoth — l'acteur ET la partie adverse", () => {
  it("notifie les deux comptes, chacun avec sa formulation", async () => {
    await notifyBoth({
      type: "deliverable_submitted",
      missionId: "m1",
      actor: { userId: "provider", message: "Votre livrable a été soumis" },
      counterpart: { userId: "client", message: "Un livrable attend votre validation" },
    });

    expect(notificationCreate).toHaveBeenCalledTimes(2);
    const targets = notificationCreate.mock.calls.map((c) => c[0].data.userId);
    expect(targets).toEqual(expect.arrayContaining(["provider", "client"]));
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("l'échec d'un côté n'empêche pas l'autre et ne rejette jamais", async () => {
    notificationCreate.mockImplementationOnce(() => Promise.reject(new Error("base indisponible")));

    await expect(
      notifyBoth({
        type: "provider_signed",
        actor: { userId: "a", message: "a" },
        counterpart: { userId: "b", message: "b" },
      })
    ).resolves.toBeUndefined();
    expect(notificationCreate).toHaveBeenCalledTimes(2);
  });
});
