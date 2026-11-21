/**
 * Sérialisation CSV pour les exports d'administration.
 *
 * Deux protections, toutes deux nécessaires dès qu'un export s'ouvre dans un tableur :
 *   · l'échappement RFC 4180 (guillemets doublés, champ entre guillemets s'il contient `;`,
 *     `"` ou un saut de ligne) ;
 *   · la neutralisation des FORMULES : une cellule qui commence par `=`, `+`, `-`, `@`, une
 *     tabulation ou un retour chariot est exécutée par Excel ou LibreOffice. Or ces exports
 *     contiennent du texte saisi par des utilisateurs (titres de mission, motifs) : un titre
 *     « =HYPERLINK(...) » deviendrait un lien piégé dans le poste de l'administrateur.
 *
 * Séparateur `;` et BOM UTF-8 : c'est ce qu'attend un Excel réglé en français pour ouvrir
 * directement le fichier avec ses accents et ses colonnes.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(";"), ...rows.map((row) => row.map(csvCell).join(";"))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}
