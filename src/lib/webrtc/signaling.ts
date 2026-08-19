// Store de signalisation in-memory pour SSE.
// En production, remplacer par Redis pub/sub.

import type { SignalMessage } from "./types";

type SSEClient = {
  userId: string;
  controller: ReadableStreamDefaultController;
};

const clients = new Map<string, SSEClient[]>();

export function addSSEClient(userId: string, controller: ReadableStreamDefaultController) {
  const existing = clients.get(userId) ?? [];
  existing.push({ userId, controller });
  clients.set(userId, existing);
}

export function removeSSEClient(userId: string, controller: ReadableStreamDefaultController) {
  const existing = clients.get(userId) ?? [];
  clients.set(userId, existing.filter(c => c.controller !== controller));
}

export function sendToUser(userId: string, message: SignalMessage) {
  const userClients = clients.get(userId) ?? [];
  const data = `data: ${JSON.stringify(message)}\n\n`;
  const encoder = new TextEncoder();
  for (const client of userClients) {
    try {
      client.controller.enqueue(encoder.encode(data));
    } catch {
      removeSSEClient(userId, client.controller);
    }
  }
}

// Pour les messages texte, on peut aussi notifier l'autre utilisateur
// qu'un nouveau message est arrivé pour qu'il rafraîchisse
export function notifyUser(userId: string, event: string, data: unknown) {
  const userClients = clients.get(userId) ?? [];
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  for (const client of userClients) {
    try {
      client.controller.enqueue(encoder.encode(msg));
    } catch {
      removeSSEClient(userId, client.controller);
    }
  }
}
