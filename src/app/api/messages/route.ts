// GET  /api/messages            — liste les conversations de l'utilisateur connecté
// GET  /api/messages?missionId=  — messages d'une conversation (mission) spécifique
// POST /api/messages             — envoie un message dans une conversation
//
// Une "conversation" = échange entre un client et un prestataire dans le cadre
// d'une Mission. Les messages sont liés à la mission (Message.missionId).
// L'interlocuteur est déterminé automatiquement :
//   - Si l'utilisateur est le client → l'interlocuteur est le prestataire (via MissionProposal)
//   - Si l'utilisateur est un prestataire → l'interlocuteur est le client de la mission

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { signPrivateFileToken } from "@/lib/storage";
import { containsLeakageAttempt } from "@/lib/leakage-detection";
import { requireMissionParty } from "@/lib/resource-guard";
import { notifyNewMessage, markConversationNotificationsRead } from "@/lib/message-notify";
import { z } from "zod";

// ---------------------------------------------------------------------------
// GET — Liste des conversations ou messages d'une conversation
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { searchParams } = new URL(req.url);
  const missionId = searchParams.get("missionId");

  // --- Messages d'une conversation spécifique ---
  if (missionId) {
    // F-01 étendu : une conversation (messages d'une mission) n'est lisible que par le
    // client propriétaire ou un prestataire ayant candidaté — jamais par un tiers (404,
    // indistinguable d'une mission inexistante).
    const guard = await requireMissionParty(missionId, userId);
    if (!guard.ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // Ouvrir le fil vaut lecture : les notifications de messagerie de cette conversation
    // passent à lues, ce qui réarme l'e-mail pour le prochain message (voir la cadence
    // documentée dans src/lib/message-notify.ts).
    await markConversationNotificationsRead(userId, missionId);

    const messages = await prisma.message.findMany({
      where: { missionId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, content: true, senderId: true, createdAt: true,
        type: true, fileName: true, filePath: true, fileSize: true, mimeType: true,
      },
    });

    return NextResponse.json({
      messages: messages.map((m) => ({
        id: m.id,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        sent: m.senderId === userId,
        type: m.type,
        fileName: m.fileName,
        fileSize: m.fileSize,
        mimeType: m.mimeType,
        url: m.type === "file" && m.filePath
          ? `/api/files/${signPrivateFileToken("message_file", m.id)}`
          : null,
      })),
    });
  }

  // --- Liste des conversations ---
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const isClient = user.role === "client";

  if (isClient) {
    // Client : missions où il est client ET où il y a au moins une proposition
    // (acceptée ou non — le chat peut démarrer dès qu'un prestataire a candidaté)
    const missions = await prisma.mission.findMany({
      where: {
        clientId: userId,
        proposals: { some: {} }, // au moins une proposition
      },
      include: {
        proposals: {
          include: {
            provider: {
              select: { id: true, firstname: true, lastname: true, role: true, country: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, content: true, senderId: true, createdAt: true, type: true, fileName: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const conversations = missions.map((m) => {
      // Prendre le premier prestataire qui a candidaté comme interlocuteur
      // (en production, on voudrait celui dont la proposition est acceptée)
      const acceptedProposal = m.proposals.find((p) => p.status === "acceptee");
      const anyProposal = acceptedProposal ?? m.proposals[0];
      const provider = anyProposal?.provider;

      const lastMsg = m.messages[0] ?? null;

      return {
        missionId: m.id,
        mission: { titre: m.titre, budget: m.budget, currency: m.currency, status: m.status },
        interlocutor: provider
          ? {
              id: provider.id,
              name: [provider.firstname, provider.lastname].filter(Boolean).join(" ") || "Prestataire",
              role: provider.role,
              country: provider.country,
            }
          : null,
        lastMessage: lastMsg
          ? {
              content: lastMsg.content,
              type: lastMsg.type,
              fileName: lastMsg.fileName,
              createdAt: lastMsg.createdAt.toISOString(),
              sent: lastMsg.senderId === userId,
            }
          : null,
      };
    });

    return NextResponse.json({ conversations });
  }

  // --- Prestataire : missions où il a candidaté ---
  const proposals = await prisma.missionProposal.findMany({
    where: { providerId: userId },
    include: {
      mission: {
        include: {
          client: {
            select: { id: true, firstname: true, lastname: true, role: true, country: true },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, content: true, senderId: true, createdAt: true, type: true, fileName: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const conversations = proposals.map((p) => {
    const m = p.mission;
    const client = m.client;
    const lastMsg = m.messages[0] ?? null;

    return {
      missionId: m.id,
      mission: { titre: m.titre, budget: m.budget, currency: m.currency, status: m.status },
      interlocutor: {
        id: client.id,
        name: [client.firstname, client.lastname].filter(Boolean).join(" ") || "Client",
        role: client.role,
        country: client.country,
      },
      lastMessage: lastMsg
        ? {
            content: lastMsg.content,
            type: lastMsg.type,
            fileName: lastMsg.fileName,
            createdAt: lastMsg.createdAt.toISOString(),
            sent: lastMsg.senderId === userId,
          }
        : null,
    };
  });

  return NextResponse.json({ conversations });
}

// ---------------------------------------------------------------------------
// POST — Envoyer un message
// ---------------------------------------------------------------------------
const postSchema = z.object({
  missionId: z.string().min(1),
  content: z.string().min(1).max(5000),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { missionId, content } = parsed.data;

  // Vérifier la participation (client de la mission OU prestataire ayant candidaté) via le
  // garde partagé — un tiers reçoit 404, indistinguable d'une mission inexistante (R02).
  const guard = await requireMissionParty(missionId, userId);
  if (!guard.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // US-1301 — bloque à l'envoi tout message contenant un numéro de téléphone ou une mention
  // de paiement direct, pour prévenir la fuite hors plateforme. Portée depuis l'ancienne route
  // POST /api/missions/[id]/messages (2026-08-29, page dédiée /missions/[id]/chat retirée,
  // doublon de Messagerie/MessageBubble) : cette route-ci est désormais le seul point d'envoi
  // réel, la garde devait donc y vivre elle aussi plutôt que de disparaître avec l'ancienne page.
  if (containsLeakageAttempt(content)) {
    return NextResponse.json({ error: "message_blocked_leakage_attempt" }, { status: 422 });
  }

  const message = await prisma.message.create({
    data: {
      missionId,
      senderId: userId,
      content,
    },
    select: { id: true, content: true, createdAt: true },
  });

  // Cloche + e-mail pour le destinataire ET pour l'expéditeur (2026-09-09). Volontairement
  // await : l'envoi doit être notifié avant que la réponse ne revienne, mais la fonction
  // n'échoue jamais — elle avale ses propres erreurs.
  await notifyNewMessage({ missionId, senderId: userId, preview: message.content });

  return NextResponse.json({
    message: {
      id: message.id,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      sent: true,
    },
  });
}
