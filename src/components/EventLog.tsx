import { useState } from "react";
import {
  Check,
  CheckCheck,
  Clipboard,
  Crosshair,
  Download,
  EyeOff,
  Pencil,
  Play,
  Radar,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { studio, useStudioVersion } from "../store";
import { eventStatus, type FrameEvent } from "../engine/types";
import { downloadCSV, toTSV } from "../engine/exporter";
import { fmtClock, fmtDur } from "../engine/time";
import { cn } from "../utils/cn";

const STATUS_STYLE = {
  NORMAL: "text-emerald-300 border-emerald-400/50 bg-emerald-400/10",
  SLOW: "text-amber-300 border-amber-400/50 bg-amber-400/10",
  BOTTLENECK: "text-red-300 border-red-500/60 bg-red-500/15 animate-pulse",
} as const;

function ThresholdInput({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-wider text-dim">
      <span style={{ color }}>{label}</span>
      <input
        type="number"
        min={1}
        max={900}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 1)}
        className="h-5 w-10 rounded border border-line bg-obsidian px-1 text-center font-mono text-[10px] text-ink outline-none focus:border-emerald-400/50"
      />
      s
    </label>
  );
}

function EditRow({ ev, onClose }: { ev: FrameEvent; onClose: () => void }) {
  const [start, setStart] = useState(ev.start.toFixed(2));
  const [end, setEnd] = useState(ev.end.toFixed(2));
  return (
    <div className="flex items-center gap-2 border-b border-line/50 bg-panel2/80 px-2.5 py-1.5">
      <span className="font-mono text-[9px] uppercase tracking-wider text-amber-300">Edit #{ev.num} (s)</span>
      <input
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="h-6 w-16 rounded border border-line bg-obsidian px-1 font-mono text-[10.5px] text-ink outline-none focus:border-amber-400/60"
      />
      <span className="font-mono text-[10px] text-dim">→</span>
      <input
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="h-6 w-16 rounded border border-line bg-obsidian px-1 font-mono text-[10.5px] text-ink outline-none focus:border-amber-400/60"
      />
      <button
        onClick={() => {
          const s = parseFloat(start);
          const en = parseFloat(end);
          if (Number.isFinite(s) && Number.isFinite(en) && en > s && s >= 0) {
            studio.editEvent(ev.id, s, en);
            studio.toast(`Event #${ev.num} adjusted — formulas re-evaluated`);
            onClose();
          } else {
            studio.toast("Invalid range — need 0 ≤ start < end", "err");
          }
        }}
        className="grid h-6 w-6 place-items-center rounded border border-emerald-400/50 text-emerald-300 hover:bg-emerald-400/10"
        title="Save"
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        onClick={onClose}
        className="grid h-6 w-6 place-items-center rounded border border-line text-dim hover:text-ink"
        title="Cancel"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function EventLog() {
  useStudioVersion();
  const [editingId, setEditingId] = useState<string | null>(null);
  const events = studio.events;
  const liveList = Object.values(studio.live);

  const copyTSV = async () => {
    try {
      await navigator.clipboard.writeText(toTSV(events, { slowAt: studio.slowAt, bottleneckAt: studio.bottleneckAt }));
      studio.toast("TSV copied — paste straight into Google Sheets / Excel");
    } catch {
      studio.toast("Clipboard blocked by browser permissions", "err");
    }
  };

  return (
    <section className="panel hud-corners flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel2/70 px-3">
        <Radar className="h-3.5 w-3.5 text-emerald-300" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink">Event log</span>
        <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 font-mono text-[9px] text-emerald-300">
          {events.filter((e) => e.verified !== "DISMISSED").length} live
        </span>
        <div className="flex-1" />
        <ThresholdInput
          label="Slow≥"
          value={studio.slowAt}
          color="#F59E0B"
          onChange={(v) => studio.setThresholds(v, studio.bottleneckAt)}
        />
        <ThresholdInput
          label="Jam≥"
          value={studio.bottleneckAt}
          color="#EF4444"
          onChange={(v) => studio.setThresholds(studio.slowAt, v)}
        />
        <button
          onClick={() =>
            downloadCSV(events, { slowAt: studio.slowAt, bottleneckAt: studio.bottleneckAt })
          }
          title="Export CSV"
          className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase text-dim transition-colors hover:border-emerald-400/50 hover:text-emerald-300"
        >
          <Download className="h-3 w-3" />
          CSV
        </button>
        <button
          onClick={copyTSV}
          title="Copy TSV for Google Sheets / Excel"
          className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase text-dim transition-colors hover:border-emerald-400/50 hover:text-emerald-300"
        >
          <Clipboard className="h-3 w-3" />
          Sheets
        </button>
      </div>

      {/* manual mark controls */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line/60 bg-obsidian/40 px-3 py-1.5">
        <Crosshair className="h-3 w-3 text-amber-300" />
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-dim">Human override:</span>
        <button
          onClick={() => studio.markStart()}
          disabled={!!studio.manualMark}
          className={cn(
            "rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-all",
            studio.manualMark
              ? "border-line text-slate-600"
              : "border-emerald-400/50 text-emerald-300 hover:bg-emerald-400/10"
          )}
        >
          Mark IN [I]
        </button>
        <button
          onClick={() => studio.markEnd()}
          disabled={!studio.manualMark}
          className={cn(
            "rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-all",
            studio.manualMark
              ? "border-red-400/60 text-red-300 hover:bg-red-400/10"
              : "border-line text-slate-600"
          )}
        >
          Mark OUT [O]
        </button>
        <div className="flex-1" />
        <span className="hidden font-mono text-[8.5px] text-dim/70 lg:block">
          click any row → video proof
        </span>
      </div>

      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
        {/* live rows */}
        {liveList.map((ls) => {
          const z = studio.zonesFind(ls.zoneId);
          return (
            <div
              key={ls.zoneId}
              className="flex items-center gap-2 border-b border-emerald-400/20 bg-emerald-400/5 px-2.5 py-1.5"
            >
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
              <span className="font-mono text-[10px] font-semibold" style={{ color: z?.color }}>
                {z?.name}
              </span>
              <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-300/90">
                recording since {fmtClock(ls.start)}
              </span>
              <span className="ml-auto rounded border border-emerald-400/40 px-1 font-mono text-[8px] uppercase text-emerald-300">
                live · gap-merge armed
              </span>
            </div>
          );
        })}

        {events.length === 0 && liveList.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <Radar className="h-6 w-6 text-dim/50" />
            <p className="font-mono text-[10px] leading-relaxed text-dim">
              No segments yet — press play. The hysteresis engine will carve
              zone activity into rows; formulas update instantly.
            </p>
          </div>
        )}

        {[...events].reverse().map((ev) => {
          const status = eventStatus(ev, studio.slowAt, studio.bottleneckAt);
          const dismissed = ev.verified === "DISMISSED";
          const isEditing = editingId === ev.id;
          const isProof = studio.proof?.eventId === ev.id;
          return (
            <div key={ev.id}>
              <div
                onClick={() => !dismissed && studio.prove(ev.id)}
                className={cn(
                  "group grid cursor-pointer grid-cols-[26px_minmax(0,1.2fr)_52px_62px_62px_46px_40px_72px] items-center gap-1.5 border-b border-line/40 px-2.5 py-1.5 transition-colors",
                  dismissed ? "opacity-40" : "hover:bg-emerald-400/5",
                  isProof && "bg-emerald-400/10"
                )}
              >
                <span className="font-mono text-[10px] text-dim">#{ev.num}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: ev.color }} />
                  <span className={cn("truncate font-mono text-[10.5px] text-ink", dismissed && "line-through")}>
                    {ev.zoneName}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1 font-mono text-[7.5px] tracking-wider",
                      ev.mode === "MANUAL"
                        ? "bg-purple-400/15 text-purple-300"
                        : ev.mode === "OBJECT"
                          ? "bg-sky-400/15 text-sky-300"
                          : "bg-emerald-400/15 text-emerald-300"
                    )}
                  >
                    {ev.mode}
                  </span>
                </span>
                <span className="font-mono text-[9.5px] text-dim">{fmtClock(ev.start)}</span>
                <span className="font-mono text-[9.5px] text-dim">{fmtClock(ev.end)}</span>
                <span className="font-mono text-[10.5px] font-semibold text-ink">{fmtDur(ev.duration)}</span>
                <span className="flex items-center" title={`peak ${(ev.peak * 100).toFixed(0)}%`}>
                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-obsidian">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${ev.peak * 100}%`, backgroundColor: ev.color }}
                    />
                  </span>
                </span>
                <span
                  className={cn(
                    "rounded border px-1 py-0.5 text-center font-mono text-[7.5px] font-semibold tracking-wider",
                    STATUS_STYLE[status]
                  )}
                >
                  {status === "BOTTLENECK" ? "JAM!" : status}
                </span>
                <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => studio.prove(ev.id)}
                    title="Replay proof segment"
                    className="grid h-5.5 w-5.5 place-items-center rounded border border-emerald-400/40 text-emerald-300 transition-all hover:bg-emerald-400/15"
                  >
                    <Play className="h-2.5 w-2.5 fill-current" />
                  </button>
                  {dismissed ? (
                    <button
                      onClick={() => studio.setVerified(ev.id, "AUTO")}
                      title="Restore event"
                      className="grid h-5.5 w-5.5 place-items-center rounded border border-line text-dim hover:text-emerald-300"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => studio.setVerified(ev.id, ev.verified === "VERIFIED" ? "AUTO" : "VERIFIED")}
                        title={ev.verified === "VERIFIED" ? "Verified" : "Verify (human-in-the-loop)"}
                        className={cn(
                          "grid h-5.5 w-5.5 place-items-center rounded border transition-all",
                          ev.verified === "VERIFIED"
                            ? "border-emerald-400/70 bg-emerald-400/20 text-emerald-300"
                            : "border-line text-dim hover:text-emerald-300"
                        )}
                      >
                        <CheckCheck className="h-2.5 w-2.5" />
                      </button>
                      <button
                        onClick={() => setEditingId(isEditing ? null : ev.id)}
                        title="Edit start/end"
                        className={cn(
                          "grid h-5.5 w-5.5 place-items-center rounded border transition-all",
                          ev.verified === "EDITED"
                            ? "border-amber-400/60 text-amber-300"
                            : "border-line text-dim hover:text-amber-300"
                        )}
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                      <button
                        onClick={() => studio.setVerified(ev.id, "DISMISSED")}
                        title="Dismiss (excluded from formulas)"
                        className="grid h-5.5 w-5.5 place-items-center rounded border border-line text-dim transition-all hover:text-slate-300"
                      >
                        <EyeOff className="h-2.5 w-2.5" />
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => studio.deleteEvent(ev.id)}
                    title="Delete permanently"
                    className="grid h-5.5 w-5.5 place-items-center rounded border border-line text-dim transition-all hover:border-red-400/50 hover:text-red-400"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </span>
              </div>
              {isEditing && <EditRow ev={ev} onClose={() => setEditingId(null)} />}
            </div>
          );
        })}
      </div>

      {/* column legend */}
      <div className="grid shrink-0 grid-cols-[26px_minmax(0,1.2fr)_52px_62px_62px_46px_40px_72px] gap-1.5 border-t border-line bg-panel2/60 px-2.5 py-1 font-mono text-[7.5px] uppercase tracking-[0.14em] text-dim/70">
        <span>#</span>
        <span>zone · mode</span>
        <span>start</span>
        <span>end</span>
        <span>dur</span>
        <span>peak</span>
        <span>status</span>
        <span className="text-right">proof / edit</span>
      </div>
    </section>
  );
}
