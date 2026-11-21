-- Un engagement est supprimé avec son annonce (2026-11-10).
ALTER TABLE "Mission" DROP CONSTRAINT "Mission_parentMissionId_fkey";
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_parentMissionId_fkey" FOREIGN KEY ("parentMissionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
