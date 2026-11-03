import { useEffect, useRef } from "react";
import {
  Activity,
  Car,
  ChevronRight,
  Package,
  PersonStanding,
  Plus,
  ScanSearch,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Wand2,
} from "lucide-react";
import { studio, telemetry, useStudioVersion } from "../store";
import type { ObjectClass, ZoneConfig } from "../engine/types";
import type { SegmenterPhase } from "../engine/segmenter";
import { cn } from "../utils/cn";

const PHASES: SegmenterPhase[] = ["IDLE", "ARMING", "ACTIVE", "COOLING"];
const PHASE_COLORS: Record<SegmenterPhase, string> = {
  IDLE: "text-slate-500 border-line",
  ARMING: "text-amber-300 border-amber-400/60 bg-amber-400/10",
  ACTIVE: "text-emerald-300 border-emerald-400/70 bg-emerald-400/15 shadow-[0_0_10px_rgba(16,185,129,0.3)]",
  COOLING: "text-sky-300 border-sky-400/60 bg-sky-400/10",
};

/** 10Hz live signal meter + sparkline, updated imperatively (no React churn). */
function SignalMeter({ zone }: { zone: ZoneConfig }) {
  const barRef = useRef<HTMLDivElement>(null);
  const sparkRef = useRef<SVGPolylineElement>(null);
  const histRef = useRef<number[]>([]);

  useEffect(() => {
    histRef.current = [];
    return telemetry.subscribe((f) => {
      const sig = f.values[zone.id];
      if (!sig) return;
      const scale = Math.max(0.0001, sig.threshold * 2.5);
      const pct = Math.min(100, (sig.value / scale) * 100);
      if (barRef.current) {
        barRef.current.style.width = `${pct}%`;
        barRef.current.style.backgroundColor = sig.active ? zone.color : "#475569";
      }
      const hist = histRef.current;
      hist.push(sig.value);
      if (hist.length > 48) hist.shift();
      if (sparkRef.current) {
        const pts = hist
          .map((v, i) => `${(i / 47) * 100},${18 - Math.min(1, v / scale) * 17}`)
          .join(" ");
        sparkRef.current.setAttribute("points", pts);
        sparkRef.current.setAttribute("stroke", sig.active ? zone.color : "#64748B");
      }
    });
  }, [zone.id, zone.color]);

  const thresholdPct = (1 / 2.5) * 100;
  return (
    <div className="space-y-1">
      <div className="relative h-2.5 overflow-hidden rounded-sm bg-obsidian/80">
        <div ref={barRef} className="h-full rounded-sm transition-[width] duration-100" style={{ width: 0 }} />
        <div
          className="absolute bottom-0 top-0 w-px bg-white/70"
          style={{ left: `${thresholdPct}%` }}
          title="threshold"
        />
      </div>
      <div className="relative h-[18px] overflow-hidden rounded-sm bg-obsidian/60">
        <svg viewBox="0 0 100 18" preserveAspectRatio="none" className="h-full w-full">
          <line x1="0" y1={18 - (1 / 2.5) * 17} x2="100" y2={18 - (1 / 2.5) * 17} stroke="rgba(255,255,255,0.25)" strokeDasharray="2 3" strokeWidth="0.5" />
          <polyline ref={sparkRef} fill="none" strokeWidth="1.2" points="" />
        </svg>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  color,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  color: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-0.5 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-dim">
        <span>{label}</span>
        <span style={{ color }}>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider h-1.5 w-full cursor-pointer appearance-none rounded-full"
        style={{
          background: `linear-gradient(90deg, ${color} ${((value - min) / (max - min)) * 100}%, #1E293B ${((value - min) / (max - min)) * 100}%)`,
          accentColor: color,
        }}
      />
    </label>
  );
}

/** Field-tested presets (values derived from the real-footage trials). */
const PRESETS = [
  {
    id: "quick" as const,
    label: "Quick Tap",
    hold: 300,
    sens: 0.05,
    overlap: 0.3,
    tip: "300ms hold · 5% sensitivity — contactless taps, fast hand-offs",
  },
  {
    id: "standard" as const,
    label: "Standard",
    hold: 800,
    sens: 0.08,
    overlap: 0.45,
    tip: "800ms hold · 8% sensitivity — checkout waits, packing cycles",
  },
  {
    id: "dwell" as const,
    label: "Long Dwell",
    hold: 1200,
    sens: 0.1,
    overlap: 0.55,
    tip: "1200ms hold · 10% sensitivity — parked vehicles, long queues",
  },
];

const CLASS_OPTIONS: { id: ObjectClass; label: string; Icon: typeof Car }[] = [
  { id: "person", label: "Person", Icon: PersonStanding },
  { id: "vehicle", label: "Vehicle", Icon: Car },
  { id: "package", label: "Package", Icon: Package },
];

export function ZonePanel() {
  useStudioVersion();
  return (
    <section className="panel hud-corners flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel2/70 px-3">
        <ScanSearch className="h-3.5 w-3.5 text-emerald-300" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink">
          Zones · Driver's-seat detection controls
        </span>
        <div className="flex-1" />
        <button
          onClick={() => studio.setInteractionMode("draw")}
          className="flex items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-dim transition-colors hover:border-emerald-400/50 hover:text-emerald-300"
        >
          <Plus className="h-3 w-3" />
          Zone
        </button>
      </div>

      <div className="scroll-slim min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
        {studio.zones.length === 0 && (
          <div className="rounded-md border border-dashed border-line p-4 text-center font-mono text-[10px] text-dim">
            No zones — hit “Draw zone” and drag on the feed.
          </div>
        )}
        {studio.zones.map((z) => {
          const phase = studio.phases[z.id] ?? "IDLE";
          const selected = studio.selectedZoneId === z.id;
          return (
            <div
              key={z.id}
              onClick={() => studio.setSelectedZone(z.id)}
              className={cn(
                "cursor-pointer rounded-lg border bg-panel2/60 p-2.5 transition-all",
                selected ? "border-slate-400/40 shadow-[0_0_16px_rgba(148,163,184,0.08)]" : "border-line/70"
              )}
              style={{ borderLeft: `3px solid ${z.color}` }}
            >
              {/* header */}
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: z.color }} />
                <input
                  value={z.name}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => studio.updateZone(z.id, { name: e.target.value.replace(/\s+/g, "_") })}
                  className="w-20 bg-transparent font-mono text-[11px] font-semibold text-ink outline-none focus:border-b focus:border-emerald-400/50"
                />
                <input
                  value={z.label}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => studio.updateZone(z.id, { label: e.target.value })}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-dim outline-none focus:border-b focus:border-emerald-400/50"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    studio.updateZone(z.id, { enabled: !z.enabled });
                  }}
                  title={z.enabled ? "Disable zone" : "Enable zone"}
                  className="text-dim transition-colors hover:text-ink"
                >
                  {z.enabled ? (
                    <ToggleRight className="h-4.5 w-4.5 text-emerald-400" />
                  ) : (
                    <ToggleLeft className="h-4.5 w-4.5" />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    studio.removeZone(z.id);
                  }}
                  title="Delete zone"
                  className="text-dim transition-colors hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* mode + class */}
              <div className="mb-2 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                {(["motion", "object"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => studio.updateZone(z.id, { mode: m })}
                    className={cn(
                      "flex items-center gap-1 rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-all",
                      z.mode === m
                        ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300"
                        : "border-line text-dim hover:text-ink"
                    )}
                  >
                    {m === "motion" ? <Activity className="h-3 w-3" /> : <ScanSearch className="h-3 w-3" />}
                    {m === "motion" ? "Motion diff" : "Object AI"}
                  </button>
                ))}
                {z.mode === "object" && (
                  <div className="ml-1 flex items-center gap-1">
                    {CLASS_OPTIONS.map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        onClick={() => studio.updateZone(z.id, { targetClass: id })}
                        title={label}
                        className={cn(
                          "grid h-6 w-6 place-items-center rounded border transition-all",
                          z.targetClass === id
                            ? "border-sky-400/70 bg-sky-400/15 text-sky-300"
                            : "border-line text-dim hover:text-ink"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* hysteresis state machine viz */}
              <div className="mb-2 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                {PHASES.map((p, i) => (
                  <div key={p} className="flex items-center gap-0.5">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[8px] tracking-[0.12em] transition-all",
                        phase === p ? PHASE_COLORS[p] : "border-line/60 text-slate-600"
                      )}
                    >
                      {p}
                    </span>
                    {i < PHASES.length - 1 && <ChevronRight className="h-2.5 w-2.5 text-slate-600" />}
                  </div>
                ))}
              </div>

              <SignalMeter zone={z} />

              {/* 1-click presets + area-aware auto-calibrate */}
              <div className="mt-2 flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <span className="mr-0.5 font-mono text-[8px] uppercase tracking-[0.18em] text-dim">
                  preset
                </span>
                {PRESETS.map((p) => {
                  const on =
                    z.startHoldMs === p.hold &&
                    (z.mode === "motion" ? z.sensitivity === p.sens : z.overlap === p.overlap);
                  return (
                    <button
                      key={p.id}
                      onClick={() => studio.applyPreset(z.id, p.id)}
                      title={p.tip}
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider transition-all",
                        on
                          ? "border-emerald-400/70 bg-emerald-400/15 text-emerald-300"
                          : "border-line text-dim hover:border-emerald-400/50 hover:text-emerald-200"
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
                <button
                  onClick={() =>
                    studio.autoCalibrate(z.id, (cb) =>
                      telemetry.subscribe((f) => {
                        const sig = f.values[z.id];
                        if (sig) cb(sig.value);
                      })
                    )
                  }
                  disabled={studio.calibratingZoneId === z.id}
                  title="Sample ~1.6s of the live feed and set the threshold just above this zone's noise floor"
                  className={cn(
                    "ml-auto flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider transition-all",
                    studio.calibratingZoneId === z.id
                      ? "border-amber-400/70 bg-amber-400/15 text-amber-300"
                      : "border-sky-400/50 text-sky-300 hover:bg-sky-400/10"
                  )}
                >
                  <Wand2
                    className={cn("h-2.5 w-2.5", studio.calibratingZoneId === z.id && "animate-spin")}
                  />
                  {studio.calibratingZoneId === z.id ? "Sampling…" : "Auto-Calibrate"}
                </button>
              </div>

              {/* sliders */}
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5" onClick={(e) => e.stopPropagation()}>
                {z.mode === "motion" ? (
                  <Slider
                    label="Sensitivity"
                    value={z.sensitivity}
                    min={0.02}
                    max={0.3}
                    step={0.005}
                    format={(v) => `${Math.round(v * 100)}%`}
                    color={z.color}
                    onChange={(v) => studio.updateZone(z.id, { sensitivity: v })}
                  />
                ) : (
                  <Slider
                    label="Min occupancy"
                    value={z.overlap}
                    min={0.1}
                    max={0.9}
                    step={0.05}
                    format={(v) => `${Math.round(v * 100)}%`}
                    color={z.color}
                    onChange={(v) => studio.updateZone(z.id, { overlap: v })}
                  />
                )}
                <Slider
                  label="Start hold"
                  value={z.startHoldMs}
                  min={200}
                  max={3000}
                  step={50}
                  format={(v) => `${v}ms`}
                  color={z.color}
                  onChange={(v) => studio.updateZone(z.id, { startHoldMs: v })}
                />
                <Slider
                  label="Merge gap"
                  value={z.gapMergeMs}
                  min={300}
                  max={4000}
                  step={50}
                  format={(v) => `${v}ms`}
                  color={z.color}
                  onChange={(v) => studio.updateZone(z.id, { gapMergeMs: v })}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
