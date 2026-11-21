import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUBLICATION_DURATION,
  applicationDeadlineLabel,
  isOpenForApplications,
  isPublicationDuration,
  placesRecherchees,
  publicationExpiry,
} from "./mission-expiry";

const DAY = 86_400_000;

describe("durée de publication → date limite de candidature", () => {
  it("compte la durée à partir de la publication", () => {
    const pub = new Date("2026-11-10T10:00:00Z");
    expect(publicationExpiry(pub, 7).toISOString()).toBe("2026-11-17T10:00:00.000Z");
    expect(publicationExpiry(pub, 30).toISOString()).toBe("2026-12-10T10:00:00.000Z");
  });
  it("durée absente ou hors liste → durée par défaut", () => {
    const pub = new Date("2026-11-10T10:00:00Z");
    expect(publicationExpiry(pub, null).getTime()).toBe(pub.getTime() + DEFAULT_PUBLICATION_DURATION * DAY);
    expect(publicationExpiry(pub, 9).getTime()).toBe(pub.getTime() + DEFAULT_PUBLICATION_DURATION * DAY);
  });
  it("seules 7, 14, 21 et 30 jours sont admises", () => {
    expect([7, 14, 21, 30].every(isPublicationDuration)).toBe(true);
    expect([0, 1, 15, 31, "14"].some(isPublicationDuration)).toBe(false);
  });
});

describe("ouverture aux candidatures", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  it("publiée et non échue → ouverte ; sans date (mission antérieure) → ouverte", () => {
    expect(isOpenForApplications({ status: "publiee", dateExpiration: new Date(now.getTime() + DAY) }, now)).toBe(true);
    expect(isOpenForApplications({ status: "publiee", dateExpiration: null }, now)).toBe(true);
  });
  it("échue, close ou pas publiée → fermée", () => {
    expect(isOpenForApplications({ status: "publiee", dateExpiration: new Date(now.getTime() - 1) }, now)).toBe(false);
    expect(isOpenForApplications({ status: "annonce_close", dateExpiration: null }, now)).toBe(false);
    expect(isOpenForApplications({ status: "brouillon", dateExpiration: null }, now)).toBe(false);
  });
});

describe("places et libellés", () => {
  it("1 prestataire par défaut", () => {
    expect(placesRecherchees({ maxCandidatures: null })).toBe(1);
    expect(placesRecherchees({ maxCandidatures: 0 })).toBe(1);
    expect(placesRecherchees({ maxCandidatures: 4 })).toBe(4);
  });
  it("libellé d'échéance", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    expect(applicationDeadlineLabel(null, now)).toBeNull();
    expect(applicationDeadlineLabel(new Date(now.getTime() - DAY), now)).toBe("Candidatures closes");
    expect(applicationDeadlineLabel(new Date(now.getTime() + 12 * 3_600_000), now)).toMatch(/dernier jour$/);
    expect(applicationDeadlineLabel(new Date(now.getTime() + 5 * DAY), now)).toMatch(/^Candidatures jusqu'au .* · J-5$/);
  });
});
