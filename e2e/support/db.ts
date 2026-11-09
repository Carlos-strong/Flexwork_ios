import { prisma } from "../../src/lib/db";
import { assertTestDatabaseUrl } from "../../src/lib/test-database";

// Accès direct à la base des tests navigateur : préparer un jeu de données (un compte vérifié, une
// mission publiée) sans rejouer dix écrans, et constater ce qu'un écran a réellement écrit.
assertTestDatabaseUrl(process.env.DATABASE_URL);

export { prisma };
