import { describe, expect, it } from "vitest";
import { isValidMinimumAge, isChantierRole, isChantierProfileAllowed, computeAge, ABSOLUTE_MINIMUM_AGE } from "./age-gate";

describe("isValidMinimumAge (A13 — plancher impératif, non administrable)", () => {
  it("accepts the legal floor and above", () => {
    expect(isValidMinimumAge(18)).toBe(true);
    expect(isValidMinimumAge(21)).toBe(true);
  });

  it("refuses anything below 18, even by one", () => {
    expect(isValidMinimumAge(17)).toBe(false);
    expect(isValidMinimumAge(0)).toBe(false);
  });
});

describe("isChantierRole", () => {
  it("flags artisan/manoeuvre/expert_btp_autres as chantier roles", () => {
    expect(isChantierRole("artisan")).toBe(true);
    expect(isChantierRole("manoeuvre")).toBe(true);
    expect(isChantierRole("expert_btp_autres")).toBe(true);
  });

  it("does not flag client or expert_digital", () => {
    expect(isChantierRole("client")).toBe(false);
    expect(isChantierRole("expert_digital")).toBe(false);
  });
});

describe("isChantierProfileAllowed (réévaluation dynamique, jamais un statut figé)", () => {
  it("never blocks non-chantier roles regardless of age", () => {
    expect(
      isChantierProfileAllowed({ role: "client", dateNaissance: new Date("2015-01-01"), minimumAge: null })
    ).toBe(true);
  });

  it("blocks a chantier profile with no verified birth date yet (KYC not done)", () => {
    expect(isChantierProfileAllowed({ role: "artisan", dateNaissance: null, minimumAge: null })).toBe(false);
  });

  it("blocks an underage chantier profile against the legal floor", () => {
    const now = new Date("2026-08-04");
    const dateNaissance = new Date("2010-01-01"); // 16 ans
    expect(isChantierProfileAllowed({ role: "manoeuvre", dateNaissance, minimumAge: null, now })).toBe(false);
  });

  it("allows a chantier profile exactly at the legal floor", () => {
    const now = new Date("2026-08-04");
    const dateNaissance = new Date("2008-08-01"); // 18 ans révolus
    expect(isChantierProfileAllowed({ role: "artisan", dateNaissance, minimumAge: null, now })).toBe(true);
  });

  it("applies a stricter country-specific threshold when set (e.g. 21 for heavy machinery)", () => {
    const now = new Date("2026-08-04");
    const dateNaissance = new Date("2007-08-01"); // 19 ans
    expect(isChantierProfileAllowed({ role: "manoeuvre", dateNaissance, minimumAge: 21, now })).toBe(false);
  });

  it("re-evaluates dynamically: the same person becomes allowed after their birthday", () => {
    const dateNaissance = new Date("2008-08-10");
    const beforeBirthday = new Date("2026-08-04"); // still 17
    const afterBirthday = new Date("2026-08-11"); // just turned 18
    expect(isChantierProfileAllowed({ role: "artisan", dateNaissance, minimumAge: null, now: beforeBirthday })).toBe(
      false
    );
    expect(isChantierProfileAllowed({ role: "artisan", dateNaissance, minimumAge: null, now: afterBirthday })).toBe(
      true
    );
  });
});

describe("computeAge", () => {
  it("accounts for whether the birthday already happened this year", () => {
    expect(computeAge(new Date("2000-08-10"), new Date("2026-08-04"))).toBe(25);
    expect(computeAge(new Date("2000-08-01"), new Date("2026-08-04"))).toBe(26);
  });
});

describe("ABSOLUTE_MINIMUM_AGE", () => {
  it("is 18", () => {
    expect(ABSOLUTE_MINIMUM_AGE).toBe(18);
  });
});
