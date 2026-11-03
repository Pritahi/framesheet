import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { studio, useStudioVersion } from "../store";
import { cn } from "../utils/cn";

const ICONS = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  err: XCircle,
};

const TONES = {
  ok: "border-emerald-400/50 text-emerald-200",
  warn: "border-amber-400/50 text-amber-200",
  err: "border-red-400/60 text-red-200",
};

export function Toasts() {
  useStudioVersion();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-1.5">
      {studio.toasts.map((t) => {
        const Icon = ICONS[t.tone];
        return (
          <div
            key={t.id}
            className={cn(
              "toast-in flex items-start gap-2 rounded-md border bg-obsidian/95 px-3 py-2 font-mono text-[10px] leading-snug shadow-2xl backdrop-blur",
              TONES[t.tone]
            )}
          >
            <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}
