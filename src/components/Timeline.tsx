import { useEffect, useRef, useState } from "react";
import {
  ChevronLast,
  Pause,
  Play,
  RotateCcw,
  StepBack,
  StepForward,
} from "lucide-react";
import { studio, telemetry, useStudioVersion } from "../store";
import { eventStatus, type FrameEvent } from "../engine/types";
import { fmtClock, fmtDur, clamp } from "../engine/time";
import { cn } from "../utils/cn";

const STATUS_COLORS = {
  NORMAL: "#10B981",
  SLOW: "#F59E0B",
  BOTTLENECK: "#EF4444",
} as const;

function Playhead() {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      setT(studio.source?.currentTime ?? 0);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const dur = studio.source?.duration || 1;
  return (
    <div
      className="pointer-events-none absolute bottom-1 top-5 z-10 w-px bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.8)]"
      style={{ left: `${clamp((t / dur) * 100, 0, 100)}%` }}
    >
      <div className="absolute -left-[5px] -top-1 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-white/90" />
    </div>
  );
}

function TransportButton({
  onClick,
  title,
  children,
  accent,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-md border transition-all active:scale-95",
        accent
          ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.25)] hover:bg-emerald-400/25"
          : "border-line bg-panel2 text-dim hover:border-slate-500/60 hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

export function Timeline() {
  useStudioVersion();
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ ev: FrameEvent; x: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  // 10Hz telemetry tick keeps live (in-progress) event bars growing smoothly
  const [, setTick] = useState(0);
  useEffect(() => telemetry.subscribe(() => setTick((n) => n + 1)), []);

  const src = studio.source;
  const dur = src?.duration ?? 0;
  const t = src?.currentTime ?? 0;
  const playing = src?.playing ?? false;

  const seekFromPointer = (clientX: number) => {
    const el = trackRef.current;
    if (!el || !src) return;
    const r = el.getBoundingClientRect();
    const u = clamp((clientX - r.left) / r.width, 0, 1);
    studio.requestSeek(u * dur);
  };

  const majorEvery = dur > 90 ? 20 : 10;

  return (
    <section className="panel hud-corners relative shrink-0">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <TransportButton onClick={() => studio.requestSeek(0)} title="Restart feed">
          <RotateCcw className="h-3.5 w-3.5" />
        </TransportButton>
        <TransportButton onClick={() => studio.requestSeek(t - 5)} title="Back 5s [←]">
          <StepBack className="h-3.5 w-3.5" />
        </TransportButton>
        <TransportButton onClick={() => src?.toggle()} title="Play / Pause [Space]" accent>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </TransportButton>
        <TransportButton onClick={() => studio.requestSeek(t + 5)} title="Forward 5s [→]">
          <StepForward className="h-3.5 w-3.5" />
        </TransportButton>
        <TransportButton onClick={() => studio.requestSeek(dur)} title="Jump to end">
          <ChevronLast className="h-3.5 w-3.5" />
        </TransportButton>

        <div className="ml-2 font-mono text-[13px] tracking-wider text-ink">
          <span className="text-emerald-300">{fmtClock(t)}</span>
          <span className="text-dim/70"> / {fmtClock(dur)}</span>
        </div>

        <div className="flex-1" />

        <div className="hidden items-center gap-3 font-mono text-[9px] uppercase tracking-[0.16em] text-dim md:flex">
          <span className="flex items-center gap-1">
            <i className="inline-block h-1.5 w-3 rounded-sm bg-emerald-400" /> normal
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-1.5 w-3 rounded-sm bg-amber-400" /> slow ≥{studio.slowAt}s
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-1.5 w-3 rounded-sm bg-red-500" /> bottleneck ≥{studio.bottleneckAt}s
          </span>
        </div>
      </div>

      {/* scrubber */}
      <div
        ref={trackRef}
        data-timeline
        className="relative mx-3 mb-2 mt-1.5 h-14 cursor-crosshair rounded-md border border-line bg-obsidian/70"
        onPointerDown={(e) => {
          setScrubbing(true);
          seekFromPointer(e.clientX);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => scrubbing && seekFromPointer(e.clientX)}
        onPointerUp={() => setScrubbing(false)}
        onPointerLeave={() => !scrubbing && setHover(null)}
      >
        {/* ruler */}
        {dur > 0 &&
          Array.from({ length: Math.floor(dur / 2) }, (_, i) => (i + 1) * 2).map((s) => {
            const major = s % majorEvery === 0;
            return (
              <div key={s} className="absolute top-0" style={{ left: `${(s / dur) * 100}%` }}>
                <div className={cn("w-px", major ? "h-2.5 bg-slate-500/70" : "h-1.5 bg-slate-700/70")} />
                {major && (
                  <div className="-translate-x-1/2 pt-1 font-mono text-[8px] tracking-wider text-dim/80">
                    {fmtClock(s).slice(0, 5)}
                  </div>
                )}
              </div>
            );
          })}

        {/* event bars */}
        {dur > 0 &&
          studio.events.map((ev) => {
            const status = eventStatus(ev, studio.slowAt, studio.bottleneckAt);
            const color = STATUS_COLORS[status];
            const dismissed = ev.verified === "DISMISSED";
            const isProof = studio.proof?.eventId === ev.id;
            return (
              <div
                key={ev.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  studio.prove(ev.id);
                }}
                onMouseEnter={(e) => {
                  const r = trackRef.current!.getBoundingClientRect();
                  setHover({ ev, x: e.clientX - r.left });
                }}
                onMouseLeave={() => setHover(null)}
                className="absolute bottom-2 h-5 cursor-pointer rounded-[3px] transition-all hover:brightness-150"
                style={{
                  left: `${(ev.start / dur) * 100}%`,
                  width: `max(3px, ${(ev.duration / dur) * 100}%)`,
                  backgroundColor: dismissed ? "transparent" : `${color}38`,
                  border: `1px solid ${dismissed ? "#47556988" : color}`,
                  boxShadow: isProof ? `0 0 0 1.5px #fff, 0 0 14px ${color}` : "none",
                  opacity: dismissed ? 0.45 : 1,
                  backgroundImage: dismissed ? "none" : undefined,
                }}
              />
            );
          })}

        {/* live in-progress segments */}
        {dur > 0 &&
          Object.values(studio.live).map((ls) => (
            <div
              key={ls.zoneId}
              className="absolute bottom-2 h-5 animate-pulse rounded-[3px] border border-dashed border-emerald-300/80 bg-emerald-300/15"
              style={{
                left: `${(ls.start / dur) * 100}%`,
                width: `max(3px, ${(Math.max(0.1, t - ls.start) / dur) * 100}%)`,
              }}
            />
          ))}

        <Playhead />

        {/* hover tooltip */}
        {hover && (
          <div
            className="pointer-events-none absolute -top-12 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-obsidian/95 px-2.5 py-1.5 font-mono text-[9.5px] text-ink shadow-xl"
            style={{ left: clamp(hover.x, 90, (trackRef.current?.clientWidth ?? 300) - 90) }}
          >
            <span style={{ color: hover.ev.color }}>#{hover.ev.num} {hover.ev.zoneName}</span>
            <span className="text-dim"> · {hover.ev.mode} · </span>
            {fmtClock(hover.ev.start)} → {fmtClock(hover.ev.end)}
            <span className="text-dim"> · </span>
            <span className="text-amber-300">{fmtDur(hover.ev.duration)}</span>
            <span className="text-dim"> · click = proof</span>
          </div>
        )}
      </div>
    </section>
  );
}
