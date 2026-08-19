// Types partagés pour la signalisation WebRTC

export type SignalType = "offer" | "answer" | "ice-candidate" | "hangup";

export type SignalMessage = {
  type: SignalType;
  from: string;   // userId émetteur
  to: string;     // userId destinataire
  payload: unknown;
  timestamp: number;
};

export type RTCIceCandidatePayload = {
  candidate: string;
  sdpMLineIndex: number | null;
  sdpMid: string | null;
};

export type RTCPeerMessage = {
  type: "offer" | "answer";
  sdp: string;
};

export type WebRTCSignal = {
  type: SignalType;
  from: string;
  payload: RTCPeerMessage | RTCIceCandidatePayload | null;
};

// Configuration STUN/TURN
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // TURN à configurer en production
    // { urls: "turn:your-turn-server.com:3478", username: "user", credential: "pass" },
  ],
  iceCandidatePoolSize: 2,
};
