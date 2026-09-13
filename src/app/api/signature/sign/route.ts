import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SignatureService } from "@/lib/signature";
import { requireContractParty } from "@/lib/resource-guard";
import { counterSignDeadline, cancelExpiredContract } from "@/lib/contract-expiry";
import { notifyMissionParties } from "@/lib/mission-notify";
import { requestContractHold } from "@/lib/escrow";

export const dynamic = "force-dynamic";

// POST /api/signature/sign — Signe un contrat avec le certificat de l'utilisateur
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  try {
    const body = await req.json();
    const { contractId, certificateId, passphrase } = body;

    if (!contractId || !certificateId || !passphrase) {
      return NextResponse.json(
        { error: "contractId, certificateId et passphrase sont requis" },
        { status: 400 }
      );
    }

    // F-02 étendu : seules les deux parties au contrat peuvent le signer. Un tiers reçoit
    // 404 (indistinguable d'un contrat inexistant) au lieu d'un 403 (qui révélerait son
    // existence).
    const guard = await requireContractParty(contractId, userId);
    if (!guard.ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // Ordre de signature (modèle mission) imposé côté serveur : le PRESTATAIRE signe en
    // premier (il accepte l'offre), le CLIENT contre-signe en dernier (il scelle l'accord).
    // Avant ce correctif, la séquence n'était qu'un indice visuel côté UI — un appel API
    // direct pouvait signer dans n'importe quel ordre.
    const order = await prisma.prestationContract.findUnique({
      where: { id: contractId },
      select: { clientId: true, providerId: true, clientSignedAt: true, providerSignedAt: true },
    });
    if (!order) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const signerIsClient = userId === order.clientId;
    if (signerIsClient) {
      if (order.clientSignedAt) {
        return NextResponse.json(
          { error: "already_signed", message: "Vous avez déjà signé ce contrat." },
          { status: 409 }
        );
      }
      if (order.providerSignedAt) {
        // Le prestataire a signé (1/2) : le client dispose de 48h pour contre-signer (2/2),
        // sinon le contrat est annulé sans pénalité (voir src/lib/contract-expiry.ts).
        if (Date.now() > counterSignDeadline(order.providerSignedAt).getTime()) {
          await cancelExpiredContract(contractId);
          return NextResponse.json(
            { error: "counter_sign_expired", message: "Délai de contre-signature (48h) dépassé — le contrat a été annulé. Le prestataire doit signer à nouveau." },
            { status: 409 }
          );
        }
      } else {
        return NextResponse.json(
          { error: "provider_must_sign_first", message: "Le prestataire doit signer le contrat en premier." },
          { status: 409 }
        );
      }
    } else {
      if (order.providerSignedAt) {
        return NextResponse.json(
          { error: "already_signed", message: "Vous avez déjà signé ce contrat." },
          { status: 409 }
        );
      }
      if (order.clientSignedAt) {
        return NextResponse.json(
          { error: "signature_order_invalid", message: "Ordre de signature invalide — le prestataire doit signer en premier." },
          { status: 409 }
        );
      }
    }

    // Vérifier que le certificat appartient bien à l'utilisateur
    const cert = await prisma.digitalCertificate.findUnique({
      where: { id: certificateId },
      select: { userId: true },
    });
    if (!cert) {
      return NextResponse.json({ error: "Certificat introuvable" }, { status: 404 });
    }
    if (cert.userId !== userId) {
      return NextResponse.json({ error: "Ce certificat ne vous appartient pas" }, { status: 403 });
    }

    const result = await SignatureService.signContract({
      contractId,
      certificateId,
      passphrase,
      signerIp: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined,
      signerUserAgent: req.headers.get("user-agent") || undefined,
    });

    // Après signature : mettre à jour le statut de la mission si les deux parties ont signé,
    // puis notifier l'autre partie (⚠️ 7 du modèle — étapes de signature).
    const signedContract = await prisma.prestationContract.findUnique({
      where: { id: contractId },
      select: {
        missionId: true,
        mission: { select: { titre: true } },
        clientId: true,
        providerId: true,
        clientSignedAt: true,
        providerSignedAt: true,
        client: { select: { firstname: true, lastname: true } },
        provider: { select: { firstname: true, lastname: true } },
      },
    });

    const bothSigned = !!signedContract?.clientSignedAt && !!signedContract?.providerSignedAt;
    if (bothSigned) {
      await prisma.mission.update({
        where: { id: signedContract!.missionId },
        data: { status: "contrat_signe" },
      });
    }

    const displayName = (u: { firstname: string | null; lastname: string | null }) =>
      [u.firstname, u.lastname].filter(Boolean).join(" ").trim() || "L'utilisateur";

    if (bothSigned && signedContract) {
      // Workflow étape 5 — la contre-signature du CLIENT (2/2) déclenche le paiement sécurisé :
      // instruction HOLD au PSP créée AUTOMATIQUEMENT (best-effort). Si les prérequis ne sont
      // pas réunis (flag PSP par zone, assurance effective pour mission à risque élevé, contrat
      // à jalons…), l'instruction n'est pas créée et le client devra la déclencher manuellement
      // depuis la page séquestre — la signature elle-même n'est jamais un échec.
      //
      // Tenté AVANT la notification de contrat signé (2026-09-10) : jusqu'ici la notification
      // partait d'abord et affirmait dans tous les cas « le paiement sous séquestre est
      // déclenché automatiquement », alors qu'un contrat à jalons (mode recommandé) reçoit
      // toujours `use_jalon_hold` et ne déclenche jamais rien. Le prestataire croyait ses
      // fonds sécurisés à tort. La notification décrit désormais ce qui s'est réellement passé.
      let holdOutcome: { ok: true; amount: number; currency: string } | { ok: false; error: string };
      try {
        const hold = await requestContractHold(contractId);
        holdOutcome = hold.ok
          ? { ok: true, amount: hold.operation.amount, currency: hold.operation.currency }
          : { ok: false, error: hold.error };
      } catch (err) {
        console.error("[signature/sign] échec du déclenchement auto du séquestre :", err);
        holdOutcome = { ok: false, error: "exception" };
      }

      // Une seule phrase, partagée par les deux parties : elles doivent lire la même chose sur
      // l'état réel du séquestre (asymétrie = litige).
      const escrowLine = holdOutcome.ok
        ? `Le paiement sous séquestre (${Math.round(holdOutcome.amount).toLocaleString("fr-FR")} ${holdOutcome.currency}) a été déclenché automatiquement.`
        : holdOutcome.error === "use_jalon_hold"
          ? "Le paiement est fractionné en jalons : le client finance chaque jalon depuis la page séquestre de la mission — aucun séquestre global n'est déclenché."
          : "Le séquestre n'a PAS pu être déclenché automatiquement — le client doit le lancer depuis la page séquestre de la mission.";

      // 2/2 — la mission est engagée : les DEUX parties sont prévenues (avant 2026-09-09,
      // seul le prestataire l'était ; le client ne recevait un signal que si le séquestre
      // automatique aboutissait juste après).
      const engagedMessage = `Mission engagée — contrat signé par les deux parties pour « ${signedContract.mission.titre} »`;
      const engagedEmail = {
        subject: "Mission engagée — contrat signé",
        text: `Les deux parties ont signé le contrat pour la mission « ${signedContract.mission.titre} ». La mission est engagée. ${escrowLine}`,
        html: `<p>Les deux parties ont signé le contrat pour la mission <strong>${signedContract.mission.titre}</strong>.</p><p>La mission est engagée. ${escrowLine}</p>`,
      };
      await notifyMissionParties({
        missionId: signedContract.missionId,
        type: "contract_locked",
        counterpart: {
          userId: signedContract.providerId,
          message: `${engagedMessage} — ${escrowLine}`,
          email: engagedEmail,
        },
        actor: {
          userId: signedContract.clientId,
          message: `${engagedMessage} — ${escrowLine}`,
          email: engagedEmail,
        },
      });
    } else if (signedContract?.providerSignedAt && !signerIsClient) {
      // 1/2 — le prestataire vient de signer : le client doit contre-signer sous 48h.
      await notifyMissionParties({
        missionId: signedContract.missionId,
        type: "provider_signed",
        counterpart: {
          userId: signedContract.clientId,
          message: `${displayName(signedContract.provider)} a signé le contrat — contre-signe sous 48h pour « ${signedContract.mission.titre} »`,
          email: {
            subject: "Contre-signature requise sous 48h",
            text: `${displayName(signedContract.provider)} a signé le contrat pour la mission « ${signedContract.mission.titre} ». Vous disposez de 48h pour contre-signer, sinon le contrat sera annulé sans pénalité.`,
            html: `<p>${displayName(signedContract.provider)} a signé le contrat pour la mission <strong>${signedContract.mission.titre}</strong>.</p><p>Vous disposez de <strong>48h</strong> pour contre-signer, sinon le contrat sera annulé sans pénalité.</p>`,
          },
        },
        actor: {
          userId,
          message: `Votre signature a été enregistrée pour « ${signedContract.mission.titre} » — le client doit contre-signer sous 48h.`,
          email: {
            subject: `Signature enregistrée — ${signedContract.mission.titre}`,
            text: `Votre signature du contrat pour la mission « ${signedContract.mission.titre} » a bien été enregistrée. Le client dispose de 48h pour contre-signer, sinon le contrat sera annulé sans pénalité.`,
          },
        },
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error signing contract:", error);
    const message = error instanceof Error ? error.message : "Erreur lors de la signature";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
