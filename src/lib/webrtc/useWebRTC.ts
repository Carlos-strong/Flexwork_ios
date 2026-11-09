"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { RTC_CONFIG, type SignalMessage } from "./types";

type CallState = "idle" | "calling" | "ringing" | "connected" | "ended";

export function useWebRTC(userId: string) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const [callState, setCallState] = useState<CallState>("idle");
  const [remoteUser, setRemoteUser] = useState<string | null>(null);
  const [remoteVideoRef, setRemoteVideoRef] = useState<HTMLVideoElement | null>(null);
  const [localVideoRef, setLocalVideoRef] = useState<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [isVideo, setIsVideo] = useState(true);
  const [remoteAudioRef, setRemoteAudioRef] = useState<HTMLAudioElement | null>(null);

  // --- Send signal via API ---
  // Déplacé AVANT ses appelants (`createPC`, `hangup`) : une liste de dépendances est évaluée
  // PENDANT le rendu, donc référencer une `const` déclarée plus bas lèverait
  // « Cannot access 'sendSignal' before initialization ». Tant que le linter réclamait
  // `sendSignal` sans qu'on puisse le déclarer ici, la seule issue était de masquer
  // l'avertissement — c'est le désordre des déclarations qui créait le faux problème.
  const sendSignal = useCallback(async (to: string, type: string, payload: unknown) => {
    await fetch("/api/webrtc/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, type, payload }),
    });
  }, []);

  // Dernier correspondant connu, pour que `hangup` n'ait PAS `remoteUser` en dépendance.
  // `remoteUser` change au début et à la fin de chaque appel : en dépendance, il recréait
  // `hangup`, donc `createPC`, donc `startCall`/`acceptCall` à chaque changement
  // d'interlocuteur. La ref fige l'identité de la fonction tout en lisant la valeur du moment
  // — et si elle n'est pas encore synchronisée, `hangup` se comporte exactement comme avant
  // (ancienne valeur capturée le temps d'un rendu).
  const remoteUserRef = useRef<string | null>(null);
  useEffect(() => { remoteUserRef.current = remoteUser; }, [remoteUser]);

  // --- Hangup ---
  const hangup = useCallback(() => {
    const peer = remoteUserRef.current;
    if (peer) {
      sendSignal(peer, "hangup", null).catch(() => {});
    }
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    pendingCandidatesRef.current = [];
    setCallState("idle");
    setRemoteUser(null);
    setError(null);
    setMuted(false);
    setVideoOff(false);
    setIsVideo(false);
    delete (window as unknown as Record<string, unknown>).__pendingOffer;
  }, [sendSignal]);

  // --- Create peer connection ---
  const createPC = useCallback(() => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && remoteUser) {
        sendSignal(remoteUser, "ice-candidate", {
          candidate: event.candidate.candidate,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          sdpMid: event.candidate.sdpMid,
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (remoteVideoRef) remoteVideoRef.srcObject = stream;
      if (remoteAudioRef) remoteAudioRef.srcObject = stream;
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
        hangup();
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setCallState("connected");
      }
    };

    return pc;
  }, [remoteUser, remoteVideoRef, remoteAudioRef, hangup, sendSignal]);

  // --- Handle incoming signals ---
  const handleSignal = useCallback(async (msg: SignalMessage) => {
    switch (msg.type) {
      case "offer": {
        setRemoteUser(msg.from);
        setCallState("ringing");
        const payload = msg.payload as { sdp: string; type: RTCSdpType; video?: boolean } | null;
        setIsVideo(payload?.video !== false);
        // Stocker l'offer pour y répondre quand l'utilisateur accepte
        (window as unknown as Record<string, unknown>).__pendingOffer = payload;
        break;
      }
      case "answer": {
        const pc = pcRef.current;
        if (pc && msg.payload) {
          const payload = msg.payload as { sdp: string; type: RTCSdpType };
          await pc.setRemoteDescription(new RTCSessionDescription(payload));
          // Appliquer les candidats en attente
          for (const c of pendingCandidatesRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          }
          pendingCandidatesRef.current = [];
        }
        break;
      }
      case "ice-candidate": {
        const pc = pcRef.current;
        if (pc && msg.payload) {
          const payload = msg.payload as { candidate: string; sdpMLineIndex: number | null; sdpMid: string | null };
          const candidate = new RTCIceCandidate({
            candidate: payload.candidate,
            sdpMLineIndex: payload.sdpMLineIndex ?? null,
            sdpMid: payload.sdpMid ?? null,
          });
          if (pc.remoteDescription) {
            await pc.addIceCandidate(candidate);
          } else {
            pendingCandidatesRef.current.push(candidate);
          }
        }
        break;
      }
      case "hangup":
        setCallState("ended");
        setTimeout(() => { hangup(); }, 1000);
        break;
    }
  }, [hangup]);

  // --- SSE connection for signaling ---
  // Déclaré APRÈS `handleSignal`, et non au montage du composant : la liste de dépendances est
  // évaluée pendant le rendu, donc un `[userId, handleSignal]` placé plus haut tomberait sur
  // une `const` non initialisée. Comme `handleSignal` est maintenant STABLE (il ne dépend que
  // de `hangup`, lui-même stable), le canal SSE s'ouvre toujours une seule fois par
  // utilisateur — la dépendance est donc déclarée pour de vrai, au lieu d'être masquée par un
  // `eslint-disable` qui laissait croire que l'effet ne consommait rien.
  useEffect(() => {
    if (!userId) return;
    const es = new EventSource("/api/webrtc/events");
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const msg: SignalMessage = JSON.parse(event.data);
        handleSignal(msg);
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // Reconnect handled by EventSource automatically
    };

    return () => { es.close(); };
  }, [userId, handleSignal]);

  // --- Start a call ---
  const startCall = useCallback(async (to: string, video = true, audio = true) => {
    try {
      setRemoteUser(to);
      setCallState("calling");
      setError(null);
      setMuted(false);
      setVideoOff(false);
      setIsVideo(video);

      const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
      localStreamRef.current = stream;
      if (localVideoRef) localVideoRef.srcObject = stream;

      const pc = createPC();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal(to, "offer", { sdp: pc.localDescription?.sdp, type: "offer", video });
    } catch (e) {
      setError((e as Error).message);
      setCallState("idle");
    }
  }, [createPC, localVideoRef, sendSignal]);

  // --- Accept incoming call ---
  const acceptCall = useCallback(async (video?: boolean, audio = true) => {
    try {
      setCallState("connected");
      setError(null);
      setMuted(false);
      setVideoOff(false);

      const offer = (window as unknown as Record<string, unknown>).__pendingOffer as { sdp: string; type: RTCSdpType; video?: boolean } | undefined;
      if (!offer || !remoteUser) return;

      const useVideo = video ?? (offer.video !== false);
      setIsVideo(useVideo);

      const stream = await navigator.mediaDevices.getUserMedia({ video: useVideo, audio });
      localStreamRef.current = stream;
      if (localVideoRef) localVideoRef.srcObject = stream;

      const pc = createPC();
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(remoteUser, "answer", { sdp: pc.localDescription?.sdp, type: "answer" });

      delete (window as unknown as Record<string, unknown>).__pendingOffer;
    } catch (e) {
      setError((e as Error).message);
      setCallState("idle");
    }
  }, [createPC, localVideoRef, remoteUser, sendSignal]);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      eventSourceRef.current?.close();
    };
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
      return next;
    });
  }, []);

  const toggleVideo = useCallback(() => {
    setVideoOff((prev) => {
      const next = !prev;
      localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = !next; });
      return next;
    });
  }, []);

  return {
    callState,
    remoteUser,
    error,
    muted,
    videoOff,
    isVideo,
    setRemoteVideoRef,
    setLocalVideoRef,
    setRemoteAudioRef,
    startCall,
    acceptCall,
    hangup,
    toggleMute,
    toggleVideo,
  };
}
