// Moteur de mise en page PDF partagé par les exports documentaires (contrat de prestation,
// devis définitif). Extrait de l'export du contrat (2026-09-13), qui en était jusque-là le
// seul porteur : le devis devait produire le MÊME document — même format A4, même bandeau
// paginé, mêmes tableaux, même échelle typographique — et recopier six cents lignes de
// peintre pour cela aurait garanti la divergence des deux exports au premier ajustement.
//
// Ce module ne connaît que des pages, du texte et des tableaux. Tout ce qui relève du SENS
// d'un document — ses articles, ses parties, ses signatures, ses totaux — reste chez
// l'appelant : le kit ne sait pas ce qu'est un contrat, et n'a pas à l'apprendre pour savoir
// dessiner un devis.
//
// Les valeurs ci-dessous sont reprises telles quelles de l'export du contrat, y compris leurs
// motifs d'origine, pour que le rendu existant reste bit pour bit identique.

import { rgb, type Color, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

// Échelle typographique mesurée sur le modèle de référence (A4 595x842) :
//   titre 16 · référence 10,5 · titre d'article 12 · corps 9,5 · en-tête/pied 7.
//
// MARGIN reste à 56 pt et NE suit PAS le modèle (18 pt) : cette valeur y est un artefact
// d'impression navigateur (marges « étroites » de Chrome), pas un choix de mise en page —
// la recopier donnerait des lignes de 559 pt, illisibles à 9,5 pt.
export const MARGIN = 56;
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const CONTENT_W = PAGE_W - MARGIN * 2;
export const HEADER_H = 32;

// Palette alignée sur l'app : #008751 titres, #18181b texte, #F2F2F3 bandeaux, #D9D9DD filets.
export const GREEN = rgb(0, 0.529, 0.318);
export const DARK = rgb(0.094, 0.094, 0.106);
export const GREY = rgb(0.42, 0.42, 0.46);
export const HEADER_BG = rgb(0.949, 0.949, 0.953);
export const TABLE_ALT = rgb(0.98, 0.98, 0.984);
export const BORDER = rgb(0.851, 0.851, 0.867);

export function wrapText(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Helvetica ne porte ni l'espace fine insécable ni l'insécable : on les ramène à l'espace. */
export function sanitize(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, " ");
}

// Nettoyage typographique des paragraphes : espaces fines, double ponctuation (concaténation
// clause + description) et espaces multiples.
export function cleanParagraph(s: string): string {
  return sanitize(s)
    .replace(/\.{2,}/g, ".")
    .replace(/\.\s+\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatMontant(n: number, devise: string): string {
  return sanitize(`${Math.round(n).toLocaleString("fr-FR")} ${devise}`);
}

export function formatDateLong(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateTime(d: Date): string {
  return d
    .toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .replace(/\u202f/g, " ");
}

/** Largeurs de colonnes en fractions de la largeur utile, converties en points. */
export function widthsFor(fractions: number[]): number[] {
  return fractions.map((f) => CONTENT_W * f);
}

export type TableOptions = {
  headers: string[];
  rows: string[][];
  widths?: number[];
  align?: ("left" | "right")[];
  total?: { label: string; value: string };
  gap?: number;
  /** Colonnes rendues en texte foncé plutôt que gris (valeurs, par opposition aux libellés). */
  darkCols?: number[];
};

/**
 * Toile paginée A4 : gère les pages, le bandeau d'en-tête, le pied « Page X sur Y », et les
 * primitives de texte et de tableau. Le titre du bandeau et l'URL du pied sont injectés —
 * c'est la seule chose que le kit a besoin de savoir du document qu'il dessine.
 */
export class PdfCanvas {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  private pdf: PDFDocument;
  private headerTitle: string;
  private docUrl: string;
  private page!: PDFPage;
  private pages: PDFPage[] = [];
  private y = 0;

  constructor(args: {
    pdf: PDFDocument;
    regular: PDFFont;
    bold: PDFFont;
    /** Rappel discret en haut de chaque page, ex. « Devis définitif — Réfection ». */
    headerTitle: string;
    /** Adresse de vérification, rappelée en pied de chaque page. */
    docUrl: string;
  }) {
    this.pdf = args.pdf;
    this.regular = args.regular;
    this.bold = args.bold;
    this.headerTitle = args.headerTitle;
    this.docUrl = args.docUrl;
  }

  /** Pose les pieds de page — « Page X sur Y » n'est connu qu'une fois tout le contenu posé. */
  finish() {
    this.pages.forEach((page, i) => this.drawFooter(page, i));
  }

  get currentPage(): PDFPage {
    return this.page;
  }

  get cursorY(): number {
    return this.y;
  }

  set cursorY(value: number) {
    this.y = value;
  }

  // ── Gestion des pages ──
  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN - HEADER_H;
    this.drawHeader();
  }

  /** Saute à la page suivante si `h` points ne tiennent pas dans l'espace restant. */
  ensure(h: number) {
    if (this.y - h < MARGIN + 14) this.newPage();
  }

  private drawHeader() {
    const p = this.page;
    p.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: HEADER_BG });
    p.drawText(sanitize(this.headerTitle), {
      x: MARGIN,
      y: PAGE_H - HEADER_H + 13,
      size: 7,
      font: this.regular,
      color: GREY,
      maxWidth: PAGE_W - MARGIN * 2 - 150,
    });
    const right = formatDateTime(new Date());
    const rw = this.regular.widthOfTextAtSize(right, 9);
    p.drawText(right, { x: PAGE_W - MARGIN - rw, y: PAGE_H - HEADER_H + 13, size: 7, font: this.regular, color: GREY });
    p.drawLine({ start: { x: 0, y: PAGE_H - HEADER_H }, end: { x: PAGE_W, y: PAGE_H - HEADER_H }, thickness: 0.8, color: BORDER });
  }

  private drawFooter(page: PDFPage, index: number) {
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 26, color: HEADER_BG });
    page.drawText(this.docUrl, { x: MARGIN, y: 9, size: 7, font: this.regular, color: GREY, maxWidth: PAGE_W - MARGIN * 2 - 120 });
    const right = `Page ${index + 1} sur ${this.pages.length}`;
    const rw = this.regular.widthOfTextAtSize(right, 7);
    page.drawText(right, { x: PAGE_W - MARGIN - rw, y: 9, size: 7, font: this.regular, color: GREY });
  }

  // ── Primitives de texte ──
  wrapped(
    text: string,
    opts: {
      size?: number;
      font?: PDFFont;
      color?: Color;
      gap?: number;
      leading?: number;
      maxWidth?: number;
      indent?: number;
      justify?: boolean;
    } = {}
  ) {
    const {
      size = 9.5,
      font = this.regular,
      color = DARK,
      gap = 0,
      leading = 3.6,
      maxWidth = CONTENT_W,
      indent = 0,
      justify = false,
    } = opts;
    const usable = maxWidth - indent;
    for (const para of cleanParagraph(text).split("\n")) {
      const lines = wrapText(para, font, size, usable);
      lines.forEach((line, li) => {
        this.ensure(size + 3);
        const isLast = li === lines.length - 1;
        if (justify && !isLast && line.includes(" ")) {
          // Justifié : répartition de l'espace excédentaire entre les mots.
          const words = line.split(" ");
          const step = (usable - font.widthOfTextAtSize(line, size)) / (words.length - 1);
          const spaceW = font.widthOfTextAtSize(" ", size);
          let cx = MARGIN + indent;
          for (const wd of words) {
            this.page.drawText(wd, { x: cx, y: this.y, size, font, color });
            cx += font.widthOfTextAtSize(wd, size) + spaceW + step;
          }
        } else {
          this.page.drawText(line, { x: MARGIN + indent, y: this.y, size, font, color });
        }
        this.y -= size * 1.28 + leading;
      });
    }
    this.y -= gap;
  }

  /** Hauteur (en points) du texte enveloppé — pour anticiper les sauts de page. */
  measureWrapped(text: string, size: number, leading: number, maxWidth: number): number {
    let h = 0;
    for (const para of cleanParagraph(text).split("\n")) {
      h += wrapText(para, this.regular, size, maxWidth).length * (size * 1.28 + leading);
    }
    return h;
  }

  /**
   * Fait démarrer une section (titre + filet + paragraphes) sur une nouvelle page si elle ne
   * tient pas dans l'espace restant — évite les paragraphes orphelins en bas de page.
   */
  keepSectionTogether(size: number, leading: number, gap: number, paragraphs: string[]) {
    const headingH = 11 * 1.28 + 2;
    const ruleH = 12;
    const parasH = paragraphs.reduce((acc, p) => acc + this.measureWrapped(p, size, leading, CONTENT_W) + gap, 0);
    if (this.y - (headingH + ruleH + parasH + 8) < MARGIN + 14) this.newPage();
  }

  heading(text: string, opts: { size?: number; gap?: number } = {}) {
    const { size = 11, gap = 3 } = opts;
    this.ensure(size + 6);
    this.page.drawText(sanitize(text), { x: MARGIN, y: this.y, size, font: this.bold, color: GREEN });
    this.y -= size * 1.28 + gap;
  }

  centered(text: string, opts: { size: number; font: PDFFont; color: Color; gap: number }) {
    const { size, font, color, gap } = opts;
    const w = font.widthOfTextAtSize(sanitize(text), size);
    this.ensure(size + 4);
    this.page.drawText(sanitize(text), { x: (PAGE_W - w) / 2, y: this.y, size, font, color });
    this.y -= size * 1.28 + gap;
  }

  rule() {
    this.ensure(12);
    this.y -= 5;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.6, color: BORDER });
    this.y -= 7;
  }

  // ── Tableaux ──
  table(opts: TableOptions) {
    const { headers, rows, total, darkCols = [] } = opts;
    const widths = opts.widths ?? headers.map(() => CONTENT_W / headers.length);
    const align = opts.align ?? headers.map(() => "left" as const);
    const pad = 5;
    const lineH = 11;
    const headerSize = 8.5;
    const bodySize = 9;

    const allRows: { cells: string[]; bold?: boolean; header?: boolean; alt?: boolean }[] = [
      { cells: headers, header: true },
      ...rows.map((r, i) => ({ cells: r, alt: i % 2 === 1 })),
    ];
    if (total) {
      allRows.push({
        cells: headers.map((_, i) => (i === 0 ? total.label : i === headers.length - 2 ? total.value : "")),
        bold: true,
      });
    }

    const heights = allRows.map((r) => {
      const maxLines = Math.max(
        1,
        ...r.cells.map(
          (c, ci) =>
            wrapText(sanitize(c), r.header || r.bold ? this.bold : this.regular, r.header ? headerSize : bodySize, widths[ci] - pad * 2)
              .length
        )
      );
      return maxLines * lineH + pad;
    });
    const totalH = heights.reduce((a, b) => a + b, 0);
    this.ensure(totalH + 8);

    const colX: number[] = [];
    let x = MARGIN;
    for (const w of widths) {
      colX.push(x);
      x += w;
    }
    const top = this.y;
    let rowTop = top;

    for (let ri = 0; ri < allRows.length; ri++) {
      const r = allRows[ri];
      const h = heights[ri];
      const bottom = rowTop - h;
      const bg = r.header || r.bold ? HEADER_BG : r.alt ? TABLE_ALT : undefined;
      if (bg) {
        this.page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_W, height: h, color: bg });
      }
      r.cells.forEach((cell, ci) => {
        const font = r.header || r.bold ? this.bold : this.regular;
        const size = r.header ? headerSize : bodySize;
        const lines = wrapText(sanitize(cell), font, size, widths[ci] - pad * 2);
        let baseline = rowTop - pad - size * 0.72;
        for (const ln of lines) {
          const tw = font.widthOfTextAtSize(ln, size);
          const lx = align[ci] === "right" ? colX[ci] + widths[ci] - pad - tw : colX[ci] + pad;
          const col = r.header || r.bold || darkCols.includes(ci) ? DARK : GREY;
          this.page.drawText(ln, { x: lx, y: baseline, size, font, color: col });
          baseline -= lineH;
        }
      });
      rowTop -= h;
    }

    // Filets : cadre extérieur, séparateurs de colonnes et de lignes.
    const bottom = top - totalH;
    this.page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_W, height: totalH, borderColor: BORDER, borderWidth: 0.6 });
    for (let ci = 1; ci < widths.length; ci++) {
      const lx = colX[ci];
      this.page.drawLine({ start: { x: lx, y: top }, end: { x: lx, y: bottom }, thickness: 0.5, color: BORDER });
    }
    let ry = top;
    for (const h of heights) {
      ry -= h;
      this.page.drawLine({ start: { x: MARGIN, y: ry }, end: { x: PAGE_W - MARGIN, y: ry }, thickness: 0.5, color: BORDER });
    }

    this.y = bottom;
    this.y -= opts.gap ?? 0;
  }
}
