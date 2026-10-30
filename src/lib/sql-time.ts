import { Prisma } from "@prisma/client";

/**
 * Horodatage pour une requête SQL brute comparée à une colonne Prisma `DateTime`
 * (`timestamp(3)` SANS fuseau, écrite en UTC par Prisma).
 *
 * Passer un `Date` tel quel ne marche pas : il part en `timestamptz`, et Postgres convertit alors
 * la colonne dans le fuseau de SA session (pas forcément UTC) — décalage de plusieurs heures sur
 * toute comparaison. Ni `now()` SQL, pour la même raison. On envoie donc l'UTC en clair, typé
 * `timestamp`.
 */
export function utcTimestamp(date: Date): Prisma.Sql {
  return Prisma.sql`${date.toISOString().slice(0, 23).replace("T", " ")}::timestamp(3)`;
}
