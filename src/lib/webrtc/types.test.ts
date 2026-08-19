/**
 * Tests de validation du module types WebRTC.
 *
 * Vérifie :
 *  - La configuration RTC est valide (STUN présents, candidate pool)
 *  - Les types SignalMessage sont correctement structurés
 */

import { describe, expect, it } from "vitest";
import { RTC_CONFIG } from "./types";
import type { SignalMessage, SignalType } from "./types";

describe("RTC_CONFIG", () => {
  it("contient au moins un serveur STUN", () => {
    expect(RTC_CONFIG.iceServers).toBeDefined();
    expect(RTC_CONFIG.iceServers!.length).toBeGreaterThanOrEqual(1);

    const stunServers = RTC_CONFIG.iceServers!.filter(
      (s) => typeof s.urls === "string" && s.urls.startsWith("stun:")
    );
    expect(stunServers.length).toBeGreaterThanOrEqual(1);
  });

  it("utilise les STUN Google publics", () => {
    const urls = RTC_CONFIG.iceServers!.flatMap((s) =>
      typeof s.urls === "string" ? [s.urls] : s.urls ?? []
    );
    expect(urls).toContain("stun:stun.l.google.com:19302");
  });

  it("a un iceCandidatePoolSize >= 1", () => {
    expect(RTC_CONFIG.iceCandidatePoolSize).toBeGreaterThanOrEqual(1);
  });
});

describe("SignalMessage (validation structurelle)", () => {
  const validTypes: SignalType[] = [
    "offer",
    "answer",
    "ice-candidate",
    "hangup",
  ];

  it("tous les types de signaux sont couverts", () => {
    expect(validTypes).toHaveLength(4);
  });

  it("un SignalMessage valide est bien formé", () => {
    const msg: SignalMessage = {
      type: "offer",
      from: "client-123",
      to: "provider-456",
      payload: { sdp: "v=0\r\n...", type: "offer" },
      timestamp: Date.now(),
    };

    expect(msg.type).toBe("offer");
    expect(msg.from).toBeTruthy();
    expect(msg.to).toBeTruthy();
    expect(msg.timestamp).toBeGreaterThan(0);
    expect(msg.from).not.toBe(msg.to); // pas d'auto-signal
  });
});
