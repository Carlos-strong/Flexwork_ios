"use client";

import { useEffect } from "react";
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { startRingback, startIncomingRing, stopRingtone } from "@/lib/webrtc/ringtone";

type VideoCallProps = {
  isOpen: boolean;
  callState: "idle" | "calling" | "ringing" | "connected" | "ended";
  remoteUser: string | null;
  error: string | null;
  muted: boolean;
  videoOff: boolean;
  isVideo: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onAccept: () => void;
  onHangup: () => void;
  onSetLocalVideo: (el: HTMLVideoElement | null) => void;
  onSetRemoteVideo: (el: HTMLVideoElement | null) => void;
  onSetRemoteAudio: (el: HTMLAudioElement | null) => void;
};

export default function VideoCallModal({
  isOpen, callState, remoteUser, error,
  muted, videoOff, isVideo, onToggleMute, onToggleVideo,
  onAccept, onHangup, onSetLocalVideo, onSetRemoteVideo, onSetRemoteAudio,
}: VideoCallProps) {
  useEffect(() => {
    if (callState === "calling") startRingback();
    else if (callState === "ringing") startIncomingRing();
    else stopRingtone();
    return () => stopRingtone();
  }, [callState]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
      <div className="relative w-full max-w-4xl h-[80vh] flex flex-col">
        {/* Error */}
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-red-500 text-white text-[13px] font-medium">{error}</div>
        )}

        {/* Remote video (full screen) */}
        {isVideo ? (
          <>
            <video
              ref={(el) => onSetRemoteVideo(el)}
              autoPlay
              playsInline
              className="w-full h-full object-cover rounded-2xl"
            />

            {/* Local video (PiP) */}
            <video
              ref={(el) => onSetLocalVideo(el)}
              autoPlay
              playsInline
              muted
              className="absolute bottom-24 right-6 w-40 h-28 object-cover rounded-xl border-2 border-white/30 shadow-lg"
            />
          </>
        ) : (
          <>
            <audio ref={(el) => onSetRemoteAudio(el)} autoPlay playsInline />
            {callState === "connected" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <div className="w-24 h-24 rounded-full bg-white/15 flex items-center justify-center">
                  <Phone className="w-10 h-10 text-white" />
                </div>
                {remoteUser && <p className="text-white/80 text-[15px] font-semibold">{remoteUser}</p>}
              </div>
            )}
          </>
        )}

        {/* Calling/Ringing overlay */}
        {(callState === "calling" || callState === "ringing") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-2xl">
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mb-4 animate-pulse">
              <Phone className="w-8 h-8 text-white" />
            </div>
            <p className="text-white text-[18px] font-semibold">
              {callState === "calling" ? `Appel de ${remoteUser ?? "..."}` : `${remoteUser ?? "..."} vous appelle...`}
            </p>
            <p className="text-white/60 text-[13px] mt-1">
              {callState === "calling" ? "Sonnerie en cours..." : "Décrochez pour répondre"}
            </p>
            {callState === "ringing" && (
              <button onClick={onAccept} className="mt-6 w-14 h-14 rounded-full bg-green-500 flex items-center justify-center hover:bg-green-400 transition-colors shadow-lg">
                <Phone className="w-6 h-6 text-white" />
              </button>
            )}
          </div>
        )}

        {/* Ended overlay */}
        {callState === "ended" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-2xl">
            <p className="text-white text-[18px] font-semibold">Appel terminé</p>
          </div>
        )}

        {/* Controls bar */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-zinc-800/90 backdrop-blur-xl rounded-full px-5 py-3">
          <button onClick={onToggleMute} className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${muted ? "bg-red-500 text-white" : "bg-white/20 text-white hover:bg-white/30"}`}>
            {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          {isVideo && (
            <button onClick={onToggleVideo} className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${videoOff ? "bg-red-500 text-white" : "bg-white/20 text-white hover:bg-white/30"}`}>
              {videoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
          )}
          <button onClick={onHangup} className="w-12 h-12 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-400 transition-colors shadow-lg">
            <PhoneOff className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
