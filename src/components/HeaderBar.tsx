import { useRef } from "react";
import {
  Factory,
  Ghost,
  Grid3X3,
  HelpCircle,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Upload,
  Video,
} from "lucide-react";
import { studio, useStudioVersion } from "../store";
import type { ScenarioId } from "../demo";
import { REAL_FOOTAGE, SCENARIOS } from "../demo";
import { cn } from "../utils/cn";

const SCENARIO_ICONS: Record<ScenarioId, typeof ShoppingCart> = {
  retail: ShoppingCart,
  factory: Factory,
  dock: Truck,
};

export function HeaderBar({ onHelp }: { onHelp: () => void }) {
  useStudioVersion();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-panel/80 px-4 backdrop-blur">
      {/* logo */}
      <div className="flex items-center gap-3">
        <div className="relative grid h-9 w-9 place-items-center rounded-lg border border-emerald-400/40 bg-emerald-400/10 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.25)]">
          <Grid3X3 className="h-5 w-5" strokeWidth={1.8} />
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
        </div>
        <div className="leading-none">
          <div className="font-display text-[17px] font-bold tracking-[0.18em] text-ink">
            FRAMESHEET
          </div>
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.28em] text-dim">
            computer vision × spreadsheet causality
          </div>
        </div>
      </div>

      {/* kiroween badge */}
      <div className="hidden items-center gap-1.5 rounded-full border border-purple-400/30 bg-purple-400/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-purple-300 md:flex">
        <Ghost className="h-3.5 w-3.5" />
        Kiroween 2026 · Frankenstein
      </div>

      <div className="mx-2 hidden h-6 w-px bg-line lg:block" />

      {/* scenario selector */}
      <div className="flex items-center gap-1.5">
        <span className="mr-1 hidden font-mono text-[9px] uppercase tracking-[0.24em] text-dim xl:block">
          Instant demo feed
        </span>
        {SCENARIOS.map((sc) => {
          const Icon = SCENARIO_ICONS[sc.id];
          const active = studio.scenarioId === sc.id;
          return (
            <button
              key={sc.id}
              onClick={() => {
                studio.initScenario(sc.id);
                setTimeout(() => studio.source?.play(), 250);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all",
                active
                  ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300 shadow-[0_0_14px_rgba(16,185,129,0.25)]"
                  : "border-line bg-panel2 text-dim hover:border-slate-500/50 hover:text-ink"
              )}
              title={sc.scene.subtitle}
            >
              <Icon className="h-3.5 w-3.5" />
              {sc.id === "retail" ? "Checkout" : sc.id === "factory" ? "Packing" : "Dock"}
            </button>
          );
        })}
        {/* 4th feed: real camera clip, bundled */}
        <button
          onClick={() => studio.initRealFootage()}
          title={`${REAL_FOOTAGE.subtitle} — ${REAL_FOOTAGE.credit}`}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all",
            studio.scenarioId === "real"
              ? "border-amber-400/70 bg-amber-400/15 text-amber-300 shadow-[0_0_14px_rgba(245,158,11,0.25)]"
              : "border-amber-400/35 bg-amber-400/5 text-amber-200/80 hover:border-amber-400/60 hover:text-amber-200"
          )}
        >
          <Video className="h-3.5 w-3.5" />
          Real footage
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all",
            studio.scenarioId === "upload"
              ? "border-sky-400/60 bg-sky-400/15 text-sky-300"
              : "border-line bg-panel2 text-dim hover:border-sky-400/50 hover:text-sky-200"
          )}
          title="Load a local .mp4 / .webm — frames never leave your machine"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/webm,video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) studio.loadFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex-1" />

      {/* zero-API guarantee chip */}
      <div className="hidden items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/5 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-emerald-300/90 lg:flex">
        <ShieldCheck className="h-3.5 w-3.5" />
        100% on-device · 0 network calls
      </div>

      <button
        onClick={onHelp}
        className="flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-dim transition-all hover:border-emerald-400/50 hover:text-emerald-300"
        title="How to use FrameSheet (3 steps)"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        How it works
      </button>
    </header>
  );
}
