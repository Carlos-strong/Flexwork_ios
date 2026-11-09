import { describe, expect, it } from "vitest";
import { gigInputSchema, normalizeGigTags, normalizeGigTitle, publishChecklist, sortPackages, videoEmbedUrl } from "./gig-rules";

const packages = [
  { tier: "basique", titre: "Logo simple", description: "Un concept de logo, fichiers PNG.", prix: 25_000, delaiJours: 3, revisions: 1 },
  { tier: "standard", titre: "Logo + charte", description: "Deux concepts, charte couleurs, PNG et SVG.", prix: 50_000, delaiJours: 5, revisions: 3 },
  { tier: "premium", titre: "Identité complète", description: "Trois concepts, charte, cartes de visite, réseaux sociaux.", prix: 90_000, delaiJours: 7, revisions: 5 },
] as const;

const valid = {
  titre: "je vais créer un logo professionnel pour votre marque",
  description: "Création d'un logo unique, adapté à votre activité et à votre clientèle. ".repeat(3),
  domaine: "Design graphique",
  tags: ["#Logo", "logo", " Identité visuelle "],
  packages: [...packages],
  videoUrl: null,
};

describe("gigInputSchema", () => {
  it("accepte un Gig complet et normalise titre et mots-clés", () => {
    const r = gigInputSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.titre).toBe("Je vais créer un logo professionnel pour votre marque");
    expect(r.data.tags).toEqual(["logo", "identité visuelle"]);
  });

  it("refuse un titre qui ne commence pas par « Je vais »", () => {
    const r = gigInputSchema.safeParse({ ...valid, titre: "Création de logo professionnel" });
    expect(r.success).toBe(false);
  });

  it("exige trois formules, une par niveau, à prix strictement progressifs", () => {
    expect(gigInputSchema.safeParse({ ...valid, packages: packages.slice(0, 2) }).success).toBe(false);
    expect(gigInputSchema.safeParse({ ...valid, packages: [packages[0], packages[0], packages[2]] }).success).toBe(false);
    const flat = [packages[0], { ...packages[1], prix: 25_000 }, packages[2]];
    expect(gigInputSchema.safeParse({ ...valid, packages: flat }).success).toBe(false);
  });

  it("limite les mots-clés à cinq et en exige au moins un", () => {
    expect(gigInputSchema.safeParse({ ...valid, tags: [] }).success).toBe(false);
    expect(gigInputSchema.safeParse({ ...valid, tags: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
  });

  it("n'accepte que des vidéos YouTube ou Vimeo", () => {
    expect(gigInputSchema.safeParse({ ...valid, videoUrl: "https://youtu.be/dQw4w9WgXcQ" }).success).toBe(true);
    expect(gigInputSchema.safeParse({ ...valid, videoUrl: "https://evil.example/video.mp4" }).success).toBe(false);
  });
});

describe("videoEmbedUrl", () => {
  it("convertit les formats YouTube et Vimeo en lecteur intégré", () => {
    expect(videoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbedUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbedUrl("https://vimeo.com/123456789")).toBe("https://player.vimeo.com/video/123456789");
  });

  it("refuse http, les autres hôtes et les identifiants douteux", () => {
    expect(videoEmbedUrl("http://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbedUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbedUrl("https://youtu.be/<script>")).toBeNull();
    expect(videoEmbedUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("helpers", () => {
  it("normalise titre et mots-clés", () => {
    expect(normalizeGigTitle("  je   vais  tout faire ")).toBe("Je vais tout faire");
    expect(normalizeGigTags(["#SEO", "seo", "", "  Web  "])).toEqual(["seo", "web"]);
  });

  it("trie les formules de Basique à Premium", () => {
    expect(sortPackages([{ tier: "premium" }, { tier: "basique" }, { tier: "standard" }]).map((p) => p.tier)).toEqual([
      "basique",
      "standard",
      "premium",
    ]);
  });

  it("checklist de publication : le visuel est exigé (image ou vidéo)", () => {
    const base = { titre: valid.titre, description: valid.description, tags: ["logo"], packagesValid: true, hasImage: false, hasVideo: false };
    expect(publishChecklist(base).find((c) => c.key === "visuel")?.done).toBe(false);
    expect(publishChecklist({ ...base, hasVideo: true }).every((c) => c.done)).toBe(true);
  });
});
