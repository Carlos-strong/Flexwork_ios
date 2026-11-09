/**
 * Rapprochement mission ⇄ prestataire, une fois les DEUX côtés branchés sur la taxonomie
 * (2026-09-23).
 *
 * Jusqu'ici, `Mission.domaine` et `Profile.mainDomain` étaient deux textes libres saisis à des
 * moments différents par deux personnes différentes, rapprochés par RECHERCHE DE SOUS-CHAÎNE
 * — donc asymétrique : un profil « Plomberie sanitaire » n'atteignait pas une mission
 * « Plomberie ».
 *
 * Les deux formulaires puisant désormais dans le même catalogue, les libellés sont
 * identiques au caractère près. Ces tests vérifient que le rapprochement devient exact, et
 * que `Profile.tags` ⇄ `Mission.tags` (comparés par `hasSome`) apporte le second niveau.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { missionDomainFilter, profileDomainFilter } from "@/lib/domain-match";

const RUN = Date.now();
let clientId = "";
let providerId = "";
let metierLibelle = "";
let metierId = "";
let autreMetierLibelle = "";
let competences: string[] = [];
const missionIds: string[] = [];
let profileId = "";

beforeAll(async () => {
  const [client, provider] = await Promise.all([
    prisma.user.create({ data: { email: `e2e-sym-c-${RUN}@flexwork.test`, tel: `+2298${String(RUN).slice(-7)}`, role: "client", country: "BJ" } }),
    prisma.user.create({ data: { email: `e2e-sym-p-${RUN}@flexwork.test`, tel: `+2289${String(RUN).slice(-7)}`, role: "artisan", country: "BJ" } }),
  ]);
  clientId = client.id;
  providerId = provider.id;

  // `orderBy` explicite : sans lui, `findFirst()` renvoie la ligne que PostgreSQL rencontre
  // en premier, ce qui dépend de l'ordre PHYSIQUE de la table — donc des insertions et
  // suppressions faites par d'autres tests. Le verdict de ce fichier changeait alors selon
  // le métier tombé sous la main (constaté 2026-09-24 : il est passé au vert puis au rouge
  // sans qu'une ligne de code change).
  const metier = await prisma.metier.findFirst({
    orderBy: { id: "asc" },
    include: { services: { take: 3, orderBy: { libelle: "asc" } } },
  });
  metierId = metier!.id;
  metierLibelle = metier!.libelle;
  competences = metier!.services.map((s) => s.libelle);
  const autre = await prisma.metier.findFirst({ where: { id: { not: metier!.id } }, orderBy: { id: "asc" } });
  autreMetierLibelle = autre!.libelle;

  // Le profil est catégorisé comme le fait désormais le formulaire : le libellé du métier
  // devient `mainDomain`, les compétences choisies deviennent `tags`.
  const profile = await prisma.profile.create({
    data: {
      userId: providerId,
      label: "Principal",
      isDefault: true,
      mainDomain: metierLibelle,
      tags: competences.slice(0, 2),
    },
  });
  profileId = profile.id;

  const [correspondante, autreDomaine] = await Promise.all([
    prisma.mission.create({
      data: {
        clientId, titre: "Mission correspondante", description: "Description assez longue pour la validation.",
        domaine: metierLibelle, tags: competences, mode: "distance", budget: 100000, delaiJours: 5, status: "publiee",
      },
    }),
    prisma.mission.create({
      data: {
        clientId, titre: "Mission autre domaine", description: "Description assez longue pour la validation.",
        domaine: autreMetierLibelle, tags: [], mode: "distance", budget: 100000, delaiJours: 5, status: "publiee",
      },
    }),
  ]);
  missionIds.push(correspondante.id, autreDomaine.id);
});

afterAll(async () => {
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.profile.deleteMany({ where: { id: profileId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("le domaine, désormais identique des deux côtés", () => {
  it("fait remonter la mission au prestataire du même métier", async () => {
    const found = await prisma.mission.findMany({
      where: { id: { in: missionIds }, ...missionDomainFilter(metierLibelle) },
    });
    expect(found.map((m) => m.titre)).toEqual(["Mission correspondante"]);
  });

  it("écarte une mission d'un autre métier", async () => {
    const found = await prisma.mission.findMany({
      where: { id: { in: missionIds }, ...missionDomainFilter(autreMetierLibelle) },
    });
    expect(found.map((m) => m.titre)).toEqual(["Mission autre domaine"]);
  });

  it("fonctionne dans l'autre sens : trouve les profils à notifier d'une publication", async () => {
    const profils = await prisma.profile.findMany({
      where: { id: profileId, ...profileDomainFilter(metierLibelle) },
    });
    expect(profils).toHaveLength(1);
  });

  it("était asymétrique avec du texte libre — ce que le catalogue supprime", async () => {
    // Le défaut historique : un profil plus précis que la mission ne matchait pas. Il ne peut
    // plus se produire, puisque les deux côtés écrivent EXACTEMENT le même libellé.
    const plusPrecis = `${metierLibelle} sanitaire`;
    const found = await prisma.mission.findMany({
      where: { id: { in: missionIds }, ...missionDomainFilter(plusPrecis) },
    });
    expect(found).toHaveLength(0); // l'ancien comportement, reproduit avec du texte libre
    // Avec le libellé du catalogue, la même recherche aboutit :
    const parCatalogue = await prisma.mission.findMany({
      where: { id: { in: missionIds }, ...missionDomainFilter(metierLibelle) },
    });
    expect(parCatalogue).toHaveLength(1);
  });
});

describe("les compétences, second niveau de rapprochement", () => {
  it("rapproche par `hasSome` un profil et une mission qui partagent une compétence", async () => {
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    const found = await prisma.mission.findMany({
      where: { id: { in: missionIds }, tags: { hasSome: profile!.tags } },
    });
    expect(found.map((m) => m.titre)).toEqual(["Mission correspondante"]);
  });

  it("ne rapproche rien quand les compétences ne se recoupent pas", async () => {
    const found = await prisma.mission.findMany({
      where: { id: { in: missionIds }, tags: { hasSome: ["Compétence inexistante"] } },
    });
    expect(found).toHaveLength(0);
  });

  it("ne peut fonctionner que parce que les deux côtés puisent au même catalogue", async () => {
    // `hasSome` compare des chaînes EXACTES : du texte libre d'un côté et un libellé choisi de
    // l'autre ne se seraient jamais rencontrés. La condition à tenir est donc que chaque
    // compétence du profil EXISTE au catalogue — pas qu'elle y soit unique.
    //
    // La version précédente exigeait une correspondance UNE À UNE et interrogeait le
    // catalogue SANS filtrer par métier : « Câblage » appartient légitimement à trois métiers
    // (Batteries et stockage, Électricité bâtiment ×2), la comparaison échouait donc dès que
    // le métier tiré au sort possédait une compétence partagée. Le défaut était masqué : il
    // ne se voyait que selon la ligne renvoyée par `findFirst()`.
    const profile = await prisma.profile.findUnique({ where: { id: profileId } });
    const services = await prisma.service.findMany({
      where: { libelle: { in: profile!.tags }, metierId },
      select: { libelle: true },
    });
    const auCatalogue = services.map((s) => s.libelle).sort();
    expect(auCatalogue).toEqual([...profile!.tags].sort());
  });
});
