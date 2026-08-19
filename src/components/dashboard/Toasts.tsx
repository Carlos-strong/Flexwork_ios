"use client";

import type { Toast } from "./types";

export function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto bg-zinc-900 text-white rounded-full px-5 py-3 text-[13px] font-medium shadow-xl flex items-center gap-2 animate-[fadeIn_200ms]">
          <span>{t.icon}</span> {t.msg}
        </div>
      ))}
    </div>
  );
}
