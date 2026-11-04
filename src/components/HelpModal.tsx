import { MousePointerClick, PlayCircle, ScanEye, Table2, Video, X } from "lucide-react";
import { studio } from "../store";

const STEPS = [
  {
    n: 1,
    Icon: PlayCircle,
    title: "Pick a feed",
    body: "Three synthesized CCTV scenarios load instantly. Or hit REAL FOOTAGE for a genuine card-terminal clip bundled in the app — pre-tuned, no file needed. You can also drag-drop your own .mp4 (it never leaves this browser).",
  },
  {
    n: 2,
    Icon: ScanEye,
    title: "Watch the zones detect",
    body: "Green boxes are zones. The engine carves activity inside them into rows with start / end / duration. Tap CV MASK on the video to see exactly which pixels it is reacting to, plus live FPS. Use the preset chips (Quick Tap / Standard / Long Dwell) or Auto-Calibrate to tune in one click.",
  },
  {
    n: 3,
    Icon: Table2,
    title: "Read the spreadsheet",
    body: "Formula cells recompute live: =MAX_DURATION(\"Zone_A\"), =COUNT_OVER(\"Zone_A\", 20), =IF(...). Red cells mean a bottleneck was found.",
  },
  {
    n: 4,
    Icon: MousePointerClick,
    title: "Click-to-Proof — the payoff",
    body: "Click any event row, any timeline bar, or a formula cell with a ▶ badge. The video jumps to that exact moment, flashes the zone and replays the segment as evidence. Export the table to CSV or paste into Sheets.",
  },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-obsidian/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel hud-corners w-full max-w-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line bg-panel2/70 px-4 py-3">
          <span className="font-display text-[14px] font-bold tracking-[0.18em] text-ink">
            HOW FRAMESHEET WORKS
          </span>
          <span className="rounded border border-purple-400/40 bg-purple-400/10 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-purple-300">
            60 second tour
          </span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded border border-line text-dim transition-colors hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="scroll-slim max-h-[70vh] space-y-2.5 overflow-y-auto p-4">
          {STEPS.map(({ n, Icon, title, body }) => (
            <div key={n} className="flex gap-3 rounded-lg border border-line/70 bg-panel2/50 p-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-emerald-400/40 bg-emerald-400/10 text-emerald-300">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink">
                  {n}. {title}
                </div>
                <p className="mt-1 font-mono text-[10px] leading-relaxed text-dim">{body}</p>
              </div>
            </div>
          ))}

          <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
              Keyboard
            </div>
            <p className="mt-1 font-mono text-[10px] text-dim">
              Space play/pause · I / O mark an event by hand · ← → skip 5s · N draw a new zone
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <button
            onClick={() => {
              studio.initRealFootage();
              onClose();
            }}
            className="flex items-center gap-1.5 rounded-md border border-amber-400/60 bg-amber-400/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-300 transition-all hover:bg-amber-400/25"
          >
            <Video className="h-3.5 w-3.5" />
            Try real footage now
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-md border border-emerald-400/60 bg-emerald-400/15 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300 transition-all hover:bg-emerald-400/25"
          >
            Start exploring
          </button>
        </div>
      </div>
    </div>
  );
}
