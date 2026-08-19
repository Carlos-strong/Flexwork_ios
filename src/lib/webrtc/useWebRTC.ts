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

  // --- SSE connection for signaling ---
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
  }, [remoteUser, remoteVideoRef, remoteAudioRef]);

  // --- Handle incoming signals ---
  const handleSignal = useCallback(async (msg: SignalMessage) => {
    switch (msg.type) {
      case "offer": {
        setRemoteUser(msg.from);
        setCallState("ringing");
        const payload = msg.payload as { sdp: string; type: string; video?: boolean } | null;
        setIsVideo(payload?.video !== false);
        // Stocker l'offer pour y répondre quand l'utilisateur accepte
        (window as Record<string, unknown>).__pendingOffer = payload;
        break;
      }
      case "answer": {
        const pc = pcRef.current;
        if (pc && msg.payload) {
          const payload = msg.payload as { sdp: string; type: string };
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
  }, []);

  // --- Send signal via API ---
  const sendSignal = useCallback(async (to: string, type: string, payload: unknown) => {
    await fetch("/api/webrtc/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, type, payload }),
    });
  }, []);

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

      const offer = (window as Record<string, unknown>).__pendingOffer as { sdp: string; type: string; video?: boolean } | undefined;
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

      delete (window as Record<string, unknown>).__pendingOffer;
    } catch (e) {
      setError((e as Error).message);
      setCallState("idle");
    }
  }, [createPC, localVideoRef, remoteUser, sendSignal]);

  // --- Hangup ---
  const hangup = useCallback(() => {
    if (remoteUser) {
      sendSignal(remoteUser, "hangup", null).catch(() => {});
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
    delete (window as Record<string, unknown>).__pendingOffer;
  }, [remoteUser, sendSignal]);

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
