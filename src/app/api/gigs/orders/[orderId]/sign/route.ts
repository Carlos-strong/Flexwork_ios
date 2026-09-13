import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { GigSignatureService } from "@/lib/gig-signature";
import { isOrderExpired, refundExpiredOrder, PROVIDER_SIGN_DEADLINE_HOURS } from "@/lib/gig-expiry";
import { notifyBoth } from "@/lib/notify";

export const dynamic = "force-dynamic";

// POST /api/gigs/orders/[orderId]/sign — signature d'une commande Gig (flux INVERSE du
// modèle Mission : le CLIENT signe en premier (1/2, il achète → les fonds sont mis sous
// séquestre), le PRESTATAIRE signe en dernier (2/2, il accepte la commande) sous 24h —
// sinon remboursement automatique au client. Ordre imposé côté serveur (défense en
// profondeur après le service GigSignatureService.signOrder).
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { orderId } = await params;

  const body = await req.json().catch(() => ({}));
  const { certificateId, passphrase } = body;
  if (!certificateId || !passphrase) {
    return NextResponse.json({ error: "certificateId et passphrase sont requis" }, { status: 400 });
  }

  // Seules les deux parties peuvent signer (404 sinon, R02).
  const order = await prisma.gigOrder.findFirst({
    where: { id: orderId, OR: [{ clientId: userId }, { providerId: userId }] },
    include: {
      gig: { select: { titre: true } },
      client: { select: { id: true, email: true, firstname: true, lastname: true } },
      provider: { select: { id: true, email: true, firstname: true, lastname: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const signerIsClient = userId === order.clientId;

  // Ordre INVERSÉ + délai 24h (mêmes messages utilisateur que le modèle Mission).
  if (signerIsClient) {
    if (order.clientSignedAt) {
      return NextResponse.json({ error: "already_signed", message: "Vous avez déjà signé cette commande." }, { status: 409 });
    }
    if (order.providerSignedAt) {
      return NextResponse.json({ error: "signature_order_invalid", message: "Le prestataire ne peut pas signer avant le client." }, { status: 409 });
    }
  } else {
    if (order.providerSignedAt) {
      return NextResponse.json({ error: "already_signed", message: "Vous avez déjà signé cette commande." }, { status: 409 });
    }
    if (!order.clientSignedAt) {
      return NextResponse.json({ error: "client_must_sign_first", message: "Le client doit signer la commande en premier." }, { status: 409 });
    }
    // Le prestataire dispose de 24h après la signature du client pour signer (2/2), sinon
    // remboursement automatique au client. Dans cette branche clientSignedAt est renseigné
    // et providerSignedAt null (sinon retournés plus haut) → isOrderExpired est exact.
    if (isOrderExpired(order)) {
      await refundExpiredOrder(orderId);
      return NextResponse.json(
        { error: "order_expired", message: `Délai de signature (${PROVIDER_SIGN_DEADLINE_HOURS}h) dépassé — la commande a été annulée et le client remboursé.` },
        { status: 409 }
      );
    }
  }

  // Le certificat doit appartenir à l'utilisateur.
  const cert = await prisma.digitalCertificate.findUnique({ where: { id: certificateId }, select: { userId: true } });
  if (!cert) return NextResponse.json({ error: "Certificat introuvable" }, { status: 404 });
  if (cert.userId !== userId) {
    return NextResponse.json({ error: "Ce certificat ne vous appartient pas" }, { status: 403 });
  }

  const result = await GigSignatureService.signOrder({
    orderId,
    certificateId,
    passphrase,
    signerIp: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || undefined,
    signerUserAgent: req.headers.get("user-agent") || undefined,
  });

  if (result.role === "CLIENT" && !result.isLocked) {
    // 1/2 — le client achète : mise sous séquestre du montant (instruction HOLD) + statut.
    await prisma.$transaction([
      prisma.gigOrderEscrowOperation.create({
        data: {
          orderId,
          pspName: "gig-hold",
          amount: order.montant,
          currency: order.currency,
          instructionType: "hold",
          status: "confirmed",
          pspConfirmedAt: new Date(),
        },
      }),
      prisma.gigOrder.update({ where: { id: orderId }, data: { status: "client_signed" } }),
    ]);
    await GigSignatureService.addAuditEntry(
      orderId,
      "GIG_HOLD_CONFIRMED",
      "Fonds placés sous séquestre — le prestataire doit signer sous 24h pour accepter la commande"
    );

    // Cloche + e-mail pour les DEUX parties (2026-09-09) : le prestataire doit signer sous
    // 24h, le client est confirmé que son paiement est bien sous séquestre. Avant, seul le
    // prestataire recevait un e-mail et rien n'alimentait la cloche.
    await notifyBoth({
      type: "gig_order_placed",
      counterpart: {
        userId: order.providerId,
        message: `Nouvelle commande à accepter sous ${PROVIDER_SIGN_DEADLINE_HOURS}h — Gig « ${order.gig.titre} », fonds déjà sous séquestre.`,
        email: {
          subject: "Nouvelle commande à accepter sous 24h",
          text: `Le client a acheté votre Gig « ${order.gig.titre} » et les fonds sont sous séquestre. Connectez-vous pour signer la commande sous ${PROVIDER_SIGN_DEADLINE_HOURS}h, sinon elle sera annulée et le client remboursé.`,
          html: `<p>Le client a acheté votre Gig <strong>${order.gig.titre}</strong> et les fonds sont sous séquestre.</p><p>Connectez-vous pour <strong>signer la commande sous ${PROVIDER_SIGN_DEADLINE_HOURS}h</strong>, sinon elle sera annulée et le client remboursé.</p>`,
        },
      },
      actor: {
        userId: order.clientId,
        message: `Votre commande « ${order.gig.titre} » est payée et sous séquestre — le prestataire doit la signer sous ${PROVIDER_SIGN_DEADLINE_HOURS}h.`,
        email: {
          subject: `Commande envoyée — ${order.gig.titre}`,
          text: `Votre paiement pour le Gig « ${order.gig.titre} » est placé sous séquestre. Le prestataire dispose de ${PROVIDER_SIGN_DEADLINE_HOURS}h pour signer la commande, sinon elle sera annulée et vous serez remboursé.`,
        },
      },
    });
  } else if (result.isLocked) {
    // 2/2 — la commande est engagée : les deux parties sont prévenues (cloche + e-mail).
    await notifyBoth({
      type: "gig_order_locked",
      counterpart: {
        userId: order.clientId,
        message: `Commande engagée — le prestataire a signé « ${order.gig.titre} », les fonds restent sous séquestre.`,
        email: {
          subject: "Commande engagée — prestataire confirmé",
          text: `Le prestataire a signé votre commande « ${order.gig.titre} ». La mission est engagée et les fonds sont sous séquestre.`,
          html: `<p>Le prestataire a signé votre commande <strong>${order.gig.titre}</strong>.</p><p>La mission est engagée et les fonds sont sous séquestre.</p>`,
        },
      },
      actor: {
        userId: order.providerId,
        message: `Vous avez signé la commande « ${order.gig.titre} » — la mission est engagée, les fonds sont sous séquestre.`,
        email: {
          subject: `Commande engagée — ${order.gig.titre}`,
          text: `Votre signature de la commande « ${order.gig.titre} » a été enregistrée. La mission est engagée et les fonds sont sous séquestre jusqu'à la livraison.`,
        },
      },
    });
  }

  return NextResponse.json({ success: true, ...result });
}
