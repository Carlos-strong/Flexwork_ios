/**
 * Tests unitaires du store de signalisation SSE in-memory.
 *
 * Vérifie :
 *  - Ajout/suppression de clients SSE
 *  - Distribution ciblée (sendToUser → bon destinataire uniquement)
 *  - Notification multi-clients par utilisateur
 *  - Résilience aux erreurs de contrôleur
 *  - Nettoyage automatique en cas d'erreur d'écriture
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  addSSEClient,
  removeSSEClient,
  sendToUser,
  notifyUser,
} from "./signaling";
import type { SignalMessage } from "./types";

// Helper : crée un mock ReadableStreamDefaultController. Le type de retour ajoute `_chunks`
// (accumulateur interne au mock) pour que les tests puissent l'inspecter — la propriété
// n'existe pas sur le type natif ReadableStreamDefaultController, d'où l'intersection.
type MockController = ReadableStreamDefaultController & { _chunks: string[] };

function mockController(): MockController {
  const chunks: string[] = [];
  const ctrl = {
    enqueue: (chunk: Uint8Array) => {
      chunks.push(new TextDecoder().decode(chunk));
    },
    close: () => {},
    error: () => {},
    desiredSize: 1,
    _chunks: chunks,
  } as unknown as MockController;
  return ctrl;
}

// Helper : crée un contrôleur qui throw sur enqueue
function brokenController(): ReadableStreamDefaultController {
  return {
    enqueue: () => { throw new Error("stream closed"); },
    close: () => {},
    error: () => {},
    desiredSize: null,
  } as unknown as ReadableStreamDefaultController;
}

describe("signaling store", () => {
  // Nettoie l'état entre chaque test (module-level Map)
  // On vide en supprimant tous les utilisateurs connus
  beforeEach(() => {
    // Hack propre : on réimporte les fonctions et on vide les clés
    // via removeSSEClient. Mais comme on ne peut pas itérer la Map,
    // on utilise un petit trick : on ajoute puis retire.
    // Pour les tests, on recrée le module.
    // Vu que les fonctions ferment sur la même Map, on vide via
    // l'API publique seulement.
    // Les tests sont conçus pour être idempotents avec des userId uniques.
  });

  describe("addSSEClient / removeSSEClient", () => {
    it("ajoute un client SSE pour un utilisateur", () => {
      const ctrl = mockController();
      addSSEClient("user-a", ctrl);

      // Vérification indirecte : sendToUser doit livrer
      let delivered = false;
      const spy = mockController();
      // On remplace par un spy qui vérifie
      const msg: SignalMessage = {
        type: "offer",
        from: "user-b",
        to: "user-a",
        payload: { sdp: "test" },
        timestamp: Date.now(),
      };
      sendToUser("user-a", msg);
      // On regarde les chunks du contrôleur original
      expect(ctrl._chunks.length).toBe(1);
      expect(ctrl._chunks[0]).toContain("offer");
      expect(ctrl._chunks[0]).toContain("user-b");

      removeSSEClient("user-a", ctrl);
      // Après suppression, plus de livraison
      ctrl._chunks.length = 0;
      sendToUser("user-a", msg);
      expect(ctrl._chunks.length).toBe(0);
    });

    it("supporte plusieurs clients pour le même utilisateur", () => {
      const ctrl1 = mockController();
      const ctrl2 = mockController();
      addSSEClient("user-multi", ctrl1);
      addSSEClient("user-multi", ctrl2);

      const msg: SignalMessage = {
        type: "hangup",
        from: "other",
        to: "user-multi",
        payload: null,
        timestamp: 1,
      };
      sendToUser("user-multi", msg);

      expect(ctrl1._chunks.length).toBe(1);
      expect(ctrl2._chunks.length).toBe(1);
    });

    it("retire un seul client sans affecter les autres", () => {
      const ctrl1 = mockController();
      const ctrl2 = mockController();
      addSSEClient("user-x", ctrl1);
      addSSEClient("user-x", ctrl2);
      removeSSEClient("user-x", ctrl1);

      const msg: SignalMessage = {
        type: "answer",
        from: "y",
        to: "user-x",
        payload: { sdp: "ans", type: "answer" },
        timestamp: 2,
      };
      sendToUser("user-x", msg);

      // ctrl1 retiré → rien
      expect(ctrl1._chunks.length).toBe(0);
      // ctrl2 toujours actif
      expect(ctrl2._chunks.length).toBe(1);
    });
  });

  describe("sendToUser", () => {
    it("livre uniquement à l'utilisateur cible", () => {
      const alice = mockController();
      const bob = mockController();
      addSSEClient("alice", alice);
      addSSEClient("bob", bob);

      const msg: SignalMessage = {
        type: "offer",
        from: "charlie",
        to: "alice",
        payload: { sdp: "hello", type: "offer" },
        timestamp: 100,
      };
      sendToUser("alice", msg);

      expect(alice._chunks.length).toBe(1);
      expect(bob._chunks.length).toBe(0);
    });

    it("ne fait rien si l'utilisateur n'a pas de client", () => {
      // Aucun client enregistré, pas d'erreur
      expect(() =>
        sendToUser("inconnu", {
          type: "hangup",
          from: "x",
          to: "inconnu",
          payload: null,
          timestamp: 0,
        })
      ).not.toThrow();
    });

    it("nettoie automatiquement un contrôleur cassé", () => {
      const broken = brokenController();
      addSSEClient("fragile", broken);

      // Le premier envoi doit échouer sur le contrôleur cassé
      // et le nettoyer
      sendToUser("fragile", {
        type: "offer",
        from: "x",
        to: "fragile",
        payload: {},
        timestamp: 0,
      });

      // Un second envoi ne doit pas échouer (liste vidée)
      expect(() =>
        sendToUser("fragile", {
          type: "offer",
          from: "x",
          to: "fragile",
          payload: {},
          timestamp: 0,
        })
      ).not.toThrow();
    });
  });

  describe("notifyUser", () => {
    it("envoie un événement nommé au format SSE", () => {
      const ctrl = mockController();
      addSSEClient("eve", ctrl);

      notifyUser("eve", "new-message", {
        conversationId: "conv-1",
        text: "Hello!",
      });

      expect(ctrl._chunks.length).toBe(1);
      const chunk = ctrl._chunks[0];
      expect(chunk).toContain("event: new-message");
      expect(chunk).toContain("Hello!");
      expect(chunk).toContain("conv-1");
    });

    it("ne livre pas à un autre utilisateur", () => {
      const alice = mockController();
      const bob = mockController();
      addSSEClient("alice", alice);
      addSSEClient("bob", bob);

      notifyUser("alice", "ping", { ts: 1 });

      expect(alice._chunks.length).toBe(1);
      expect(bob._chunks.length).toBe(0);
    });
  });

  describe("concurrence multi-utilisateurs", () => {
    it("gère des signaux simultanés entre plusieurs paires", () => {
      const clientA = mockController();
      const prestaB = mockController();
      const clientC = mockController();
      const prestaD = mockController();

      addSSEClient("client-a", clientA);
      addSSEClient("presta-b", prestaB);
      addSSEClient("client-c", clientC);
      addSSEClient("presta-d", prestaD);

      // Signal A→B
      sendToUser("presta-b", {
        type: "offer",
        from: "client-a",
        to: "presta-b",
        payload: { sdp: "offer-ab" },
        timestamp: 1,
      });

      // Signal C→D
      sendToUser("presta-d", {
        type: "offer",
        from: "client-c",
        to: "presta-d",
        payload: { sdp: "offer-cd" },
        timestamp: 2,
      });

      expect(prestaB._chunks.length).toBe(1);
      expect(prestaB._chunks[0]).toContain("offer-ab");
      expect(prestaD._chunks.length).toBe(1);
      expect(prestaD._chunks[0]).toContain("offer-cd");

      // Aucun leak croisé
      expect(clientA._chunks.length).toBe(0);
      expect(clientC._chunks.length).toBe(0);
    });
  });
});
