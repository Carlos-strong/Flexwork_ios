"use client";

// Sonneries d'appel style Telegram, synthétisées via Web Audio API (timbre marimba
// percutant, aucune ressource audio externe). Le motif réel de Telegram étant un
// enregistrement propriétaire, on en reproduit la couleur (chime claire et rapide).
// - startRingback()   : tonalité entendue par l'appelant pendant la sonnerie.
// - startIncomingRing(): sonnerie entendue par l'appelé.
// - stopRingtone()    : coupe toute sonnerie en cours.

let audioCtx: AudioContext | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
const activeNodes = new Set<AudioNode>();

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Note « marimba » : fondamentale + harmonique 4, attaque rapide, décroissance courte. */
function chime(freq: number, offsetMs: number, velocity = 0.22) {
  const ctx = ensureCtx();
  if (!ctx) return;
  const t = ctx.currentTime + offsetMs / 1000;
  const dur = 0.55;

  const make = (mult: number, amp: number, decay: number) => {
    const g = ctx.createGain();
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq * mult;
    o.connect(g);
    o.start(t);
    o.stop(t + decay + 0.05);
    activeNodes.add(g);
    activeNodes.add(o);
  };

  make(1, velocity, dur);
  make(4, velocity * 0.3, dur * 0.45);
}

function later(fn: () => void, ms: number) {
  const id = setTimeout(() => {
    pendingTimers.delete(id);
    fn();
  }, ms);
  pendingTimers.add(id);
}

function clearPending() {
  for (const id of pendingTimers) clearTimeout(id);
  pendingTimers.clear();
}

function stopActive() {
  for (const node of activeNodes) {
    try {
      if (node instanceof OscillatorNode) node.stop();
      if (node instanceof GainNode) node.disconnect();
    } catch {
      /* déjà arrêté */
    }
  }
  activeNodes.clear();
}

export function stopRingtone() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  clearPending();
  stopActive();
}

/** Retour d'appel (appelant) : double chime espacée, répétée. */
export function startRingback() {
  stopRingtone();
  const motif = () => {
    chime(783.99, 0); // G5
    later(() => chime(783.99, 0), 220);
  };
  motif();
  interval = setInterval(motif, 2600);
}

/** Sonnerie entrante (appelé) : motif rapide type Telegram (mi-sol-mi-sol). */
export function startIncomingRing() {
  stopRingtone();
  const motif = () => {
    chime(659.25, 0); // E5
    chime(783.99, 170); // G5
    chime(659.25, 340); // E5
    chime(783.99, 510, 0.26); // G5 accentué
  };
  motif();
  interval = setInterval(motif, 3000);
}
