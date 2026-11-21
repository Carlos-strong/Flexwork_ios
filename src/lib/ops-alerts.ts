import { prisma } from "@/lib/db";
import { deliverMail } from "@/lib/mail";
import type { Anomaly } from "@/lib/admin-finance";
import type { PaymentQueueHealth } from "@/lib/psp/reconcile";

// ---------------------------------------------------------------------------
// Alertes d'exploitation (2026-10-01).
//
// Jusqu'ici, une anomalie (instruction PSP abandonnée, webhook en échec, SMTP en panne, règle
// d'or du séquestre violée) n'existait que dans un journal ou sur un écran d'administration
// qu'il fallait penser à ouvrir. Le worker évalue désormais ces signaux et PRÉVIENT :
//   - ALERT_WEBHOOK_URL : POST JSON `{ text, content }` — compatible Slack, Mattermost, Discord,
//     Google Chat et tout récepteur générique ;
//   - ALERT_EMAILS : adresses séparées par des virgules, envoi DIRECT au SMTP (pas par la file
//     des e-mails : si c'est elle qui est en panne, l'alerte doit quand même partir).
//
// Une alerte par clé : ouverte et annoncée à la première détection, rappelée toutes les
// ALERT_REPEAT_HOURS (6 h) tant qu'elle dure, annoncée résolue quand elle disparaît.
// ---------------------------------------------------------------------------

export type AlertSeverity = "critical" | "warning";
export type AlertSignal = { key: string; severity: AlertSeverity; title: string; detail: string };

type EmailHealth = { pending: number; late: number; failed: number };

export function signalsFromQueues(payments: PaymentQueueHealth, emails: EmailHealth): AlertSignal[] {
  const out: AlertSignal[] = [];
  const add = (cond: number, key: string, severity: AlertSeverity, title: string, detail: string) => {
    if (cond > 0) out.push({ key, severity, title, detail });
  };
  add(payments.outboxAbandoned, "queues.psp_outbox_abandoned", "critical", "Instructions PSP abandonnées",
    `${payments.outboxAbandoned} instruction(s) n'ont pas pu être transmises au PSP après toutes les tentatives (dispatchStatus = echec_envoi).`);
  add(payments.outboxLate, "queues.psp_outbox_late", "warning", "Instructions PSP en retard",
    `${payments.outboxLate} instruction(s) attendent leur transmission depuis plus de 5 min — worker arrêté ou PSP injoignable ?`);
  add(payments.stalePending, "queues.psp_stale", "warning", "Opérations PSP sans réponse",
    `${payments.stalePending} opération(s) transmise(s) sans confirmation du PSP depuis plus de 15 min.`);
  add(payments.inboxFailed, "queues.psp_inbox_failed", "critical", "Webhooks PSP en échec",
    `${payments.inboxFailed} webhook(s) reçus n'ont pas pu être appliqués après toutes les tentatives (PspInboundEvent.status = echec).`);
  add(emails.failed, "queues.emails_failed", "warning", "E-mails abandonnés",
    `${emails.failed} e-mail(s) n'ont pas pu être remis au SMTP après toutes les tentatives.`);
  add(emails.late, "queues.emails_late", "warning", "E-mails en retard",
    `${emails.late} e-mail(s) attendent depuis plus de 10 min — SMTP indisponible ?`);
  return out;
}

/** Anomalies CRITIQUES du registre financier, regroupées par nature (une alerte par nature). */
export function signalsFromFinance(anomalies: Anomaly[]): AlertSignal[] {
  const byKind = new Map<string, Anomaly[]>();
  for (const a of anomalies) {
    if (a.severity !== "critical") continue;
    byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);
  }
  return [...byKind.entries()].map(([kind, list]) => ({
    key: `finance.${kind}`,
    severity: "critical" as const,
    title: `Registre financier : ${list[0].title}${list.length > 1 ? ` (+${list.length - 1})` : ""}`,
    detail: list
      .slice(0, 5)
      .map((a) => `• ${a.title} — ${a.detail}`)
      .join("\n") + (list.length > 5 ? `\n… et ${list.length - 5} autre(s). Voir Administration › Finance.` : ""),
  }));
}

export type AlertNotifier = (message: { subject: string; text: string }) => Promise<void>;

/** Canaux configurés. Aucun : les alertes restent consignées (table OpsAlert, journaux). */
export function notifierFromEnv(env: Record<string, string | undefined> = process.env): AlertNotifier {
  const webhook = env.ALERT_WEBHOOK_URL;
  const emails = (env.ALERT_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  return async ({ subject, text }) => {
    const body = `*${subject}*\n${text}`;
    if (webhook) {
      try {
        const res = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: body, content: body.slice(0, 1900) }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) console.error(`[alertes] webhook HTTP ${res.status}`);
      } catch (error) {
        console.error("[alertes] webhook injoignable", error);
      }
    }
    for (const to of emails) {
      try {
        await deliverMail({ to, subject: `[Flexwork] ${subject}`, text });
      } catch (error) {
        console.error(`[alertes] e-mail à ${to} impossible`, error);
      }
    }
    if (!webhook && emails.length === 0) console.warn(`[alertes] ${subject} — ${text}`);
  };
}

export type AlertRunReport = { opened: string[]; reminded: string[]; resolved: string[] };

function repeatMs(): number {
  return Number(process.env.ALERT_REPEAT_HOURS ?? 6) * 60 * 60_000;
}

/**
 * Confronte les signaux du moment aux alertes ouvertes de la même PORTÉE (préfixe de clé) :
 * ouvre les nouvelles, rappelle celles qui durent, résout celles qui ont disparu. La portée
 * empêche un contrôle de résoudre les alertes d'un autre (le bilan des files ne doit pas clore
 * une alerte financière).
 */
export async function evaluateAlerts(
  scope: string,
  signals: AlertSignal[],
  notify: AlertNotifier = notifierFromEnv(),
  now: Date = new Date()
): Promise<AlertRunReport> {
  const report: AlertRunReport = { opened: [], reminded: [], resolved: [] };
  const open = await prisma.opsAlert.findMany({ where: { key: { startsWith: scope }, resolvedAt: null } });
  const openByKey = new Map(open.map((a) => [a.key, a]));

  for (const s of signals) {
    if (!s.key.startsWith(scope)) continue;
    const existing = openByKey.get(s.key);
    if (!existing) {
      await prisma.opsAlert.upsert({
        where: { key: s.key },
        // Clé déjà vue puis résolue : on la rouvre comme une nouvelle alerte.
        update: { ...s, firstSeenAt: now, lastSeenAt: now, lastNotifiedAt: now, resolvedAt: null },
        create: { ...s, firstSeenAt: now, lastSeenAt: now, lastNotifiedAt: now },
      });
      await notify({ subject: `${s.severity === "critical" ? "🔴" : "🟠"} ${s.title}`, text: s.detail });
      report.opened.push(s.key);
      continue;
    }
    const due = !existing.lastNotifiedAt || now.getTime() - existing.lastNotifiedAt.getTime() >= repeatMs();
    await prisma.opsAlert.update({
      where: { id: existing.id },
      data: { severity: s.severity, title: s.title, detail: s.detail, lastSeenAt: now, ...(due ? { lastNotifiedAt: now } : {}) },
    });
    if (due) {
      const since = Math.round((now.getTime() - existing.firstSeenAt.getTime()) / 60_000);
      await notify({ subject: `${s.severity === "critical" ? "🔴" : "🟠"} Toujours en cours (${since} min) : ${s.title}`, text: s.detail });
      report.reminded.push(s.key);
    }
  }

  const current = new Set(signals.map((s) => s.key));
  for (const a of open) {
    if (current.has(a.key)) continue;
    await prisma.opsAlert.update({ where: { id: a.id }, data: { resolvedAt: now } });
    await notify({ subject: `✅ Résolu : ${a.title}`, text: `Plus détecté depuis ${now.toISOString()}.` });
    report.resolved.push(a.key);
  }
  return report;
}

