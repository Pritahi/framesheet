import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, PenLine, ScanEye, ScanSearch, SquareDashedMousePointer } from "lucide-react";
import { studio, telemetry, useStudioVersion } from "../store";
import type { ZoneConfig, ZoneRect } from "../engine/types";
import { fmtClock } from "../engine/time";
import { cn } from "../utils/cn";

interface BlobBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cls: string;
  area: number;
}

type DragState =
  | { kind: "move"; zoneId: string; grabDX: number; grabDY: number; orig: ZoneRect }
  | { kind: "resize"; zoneId: string; corner: "nw" | "ne" | "sw" | "se"; orig: ZoneRect }
  | { kind: "draw"; startX: number; startY: number };

const BLOB_COLORS: Record<string, string> = {
  person: "#10B981",
  vehicle: "#38BDF8",
  package: "#F59E0B",
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Live CV mask + FPS HUD. Paints the detector's own 192×108 classification. */
function DiagnosticsLayer() {
  const maskRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      telemetry.subscribe((f) => {
        const cv = maskRef.current;
        if (cv && f.mask && f.maskW && f.maskH) {
          if (cv.width !== f.maskW || cv.height !== f.maskH) {
            cv.width = f.maskW;
            cv.height = f.maskH;
          }
          const ctx = cv.getContext("2d");
          if (ctx) {
            const img = ctx.createImageData(f.maskW, f.maskH);
            const d = img.data;
            for (let i = 0, j = 0; i < f.mask.length; i++, j += 4) {
              const m = f.mask[i];
              if (m === 0) {
                d[j + 3] = 0;
              } else if (m === 1) {
                // motion only → emerald
                d[j] = 16;
                d[j + 1] = 230;
                d[j + 2] = 140;
                d[j + 3] = 150;
              } else if (m === 2) {
                // foreground only → sky
                d[j] = 56;
                d[j + 1] = 150;
                d[j + 2] = 248;
                d[j + 3] = 130;
              } else {
                // both → amber (strongest evidence)
                d[j] = 250;
                d[j + 1] = 190;
                d[j + 2] = 60;
                d[j + 3] = 185;
              }
            }
            ctx.putImageData(img, 0, 0);
          }
        }
        if (hudRef.current) {
          hudRef.current.textContent = `${f.fps.toFixed(1)} Hz · ${f.costMs.toFixed(2)} ms/frame · ${f.blobs.length} blobs · 192×108`;
        }
      }),
    []
  );

  return (
    <>
      <canvas
        ref={maskRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ imageRendering: "pixelated", mixBlendMode: "screen" }}
      />
      <div className="pointer-events-none absolute left-2 top-2 space-y-1">
        <div
          ref={hudRef}
          className="rounded border border-emerald-400/40 bg-obsidian/85 px-2 py-1 font-mono text-[9px] tracking-wider text-emerald-300"
        >
          starting…
        </div>
        <div className="flex flex-col gap-0.5 rounded border border-line bg-obsidian/85 px-2 py-1 font-mono text-[8px] uppercase tracking-wider">
          <span className="text-emerald-300">■ motion pixels (frame-diff)</span>
          <span className="text-sky-300">■ foreground (background model)</span>
          <span className="text-amber-300">■ both — strongest evidence</span>
        </div>
      </div>
    </>
  );
}

export function Stage() {
  useStudioVersion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [blobs, setBlobs] = useState<BlobBox[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drawPreview, setDrawPreview] = useState<ZoneRect | null>(null);

  /* ---------------------------- frame render loop --------------------------- */
  useEffect(() => {
    let raf = 0;
    let lastV = -1;
    let lastT = -1;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const src = studio.source;
      const wrap = wrapRef.current;
      const cv = canvasRef.current;
      if (!src || !wrap || !cv) return;
      const v = studio.version;
      const t = src.currentTime;
      if (!src.playing && v === lastV && Math.abs(t - lastT) < 0.0005) return;
      lastV = v;
      lastT = t;
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(rect.width * dpr));
      const h = Math.max(2, Math.round(rect.height * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      src.renderInto(ctx, w, h);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ------------------------------ blob telemetry ---------------------------- */
  useEffect(
    () =>
      telemetry.subscribe((f) => {
        setBlobs(f.blobs.slice(0, 8));
      }),
    []
  );
  useEffect(() => {
    if (!studio.source?.playing) setBlobs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.version]);

  /* ------------------------------ pointer math ------------------------------ */
  const normPos = useCallback((e: React.PointerEvent): { nx: number; ny: number } => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { nx: clamp01((e.clientX - r.left) / r.width), ny: clamp01((e.clientY - r.top) / r.height) };
  }, []);

  const beginZoneDrag = (e: React.PointerEvent, z: ZoneConfig) => {
    e.stopPropagation();
    studio.setSelectedZone(z.id);
    if (studio.interactionMode !== "select") return;
    const { nx, ny } = normPos(e);
    setDrag({ kind: "move", zoneId: z.id, grabDX: nx - z.rect.x, grabDY: ny - z.rect.y, orig: { ...z.rect } });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const beginResize = (e: React.PointerEvent, z: ZoneConfig, corner: "nw" | "ne" | "sw" | "se") => {
    e.stopPropagation();
    studio.setSelectedZone(z.id);
    setDrag({ kind: "resize", zoneId: z.id, corner, orig: { ...z.rect } });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onOverlayDown = (e: React.PointerEvent) => {
    if (studio.interactionMode !== "draw") return;
    const { nx, ny } = normPos(e);
    setDrag({ kind: "draw", startX: nx, startY: ny });
    setDrawPreview({ x: nx, y: ny, w: 0, h: 0 });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { nx, ny } = normPos(e);
    if (drag.kind === "draw") {
      setDrawPreview({
        x: Math.min(drag.startX, nx),
        y: Math.min(drag.startY, ny),
        w: Math.abs(nx - drag.startX),
        h: Math.abs(ny - drag.startY),
      });
      return;
    }
    if (drag.kind === "move") {
      const z = studio.zonesFind(drag.zoneId);
      if (!z) return;
      const w = drag.orig.w;
      const h = drag.orig.h;
      studio.updateZone(drag.zoneId, {
        rect: {
          x: Math.min(1 - w, Math.max(0, nx - drag.grabDX)),
          y: Math.min(1 - h, Math.max(0, ny - drag.grabDY)),
          w,
          h,
        },
      });
      return;
    }
    // resize
    const o = drag.orig;
    let { x, y, w, h } = o;
    if (drag.corner.includes("w")) {
      const nx2 = Math.min(nx, o.x + o.w - 0.03);
      x = nx2;
      w = o.x + o.w - nx2;
    }
    if (drag.corner.includes("e")) w = Math.max(0.03, nx - o.x);
    if (drag.corner.includes("n")) {
      const ny2 = Math.min(ny, o.y + o.h - 0.03);
      y = ny2;
      h = o.y + o.h - ny2;
    }
    if (drag.corner.includes("s")) h = Math.max(0.03, ny - o.y);
    studio.updateZone(drag.zoneId, {
      rect: { x: clamp01(x), y: clamp01(y), w: Math.min(w, 1 - clamp01(x)), h: Math.min(h, 1 - clamp01(y)) },
    });
  };

  const onPointerUp = () => {
    if (drag?.kind === "draw" && drawPreview && drawPreview.w > 0.03 && drawPreview.h > 0.03) {
      const z = studio.addZone(drawPreview);
      studio.toast(`${z.name} created — tune its mode below`);
      studio.setInteractionMode("select");
    }
    setDrag(null);
    setDrawPreview(null);
  };

  const playing = studio.source?.playing ?? false;
  const proof = studio.proof;
  const proofEvent = proof ? studio.events.find((e) => e.id === proof.eventId) : null;

  return (
    <section className="panel hud-corners relative shrink-0 overflow-hidden">
      {/* chrome strip */}
      <div className="flex h-9 items-center gap-3 border-b border-line bg-panel2/70 px-3">
        <div className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", playing ? "animate-pulse bg-red-500" : "bg-slate-600")} />
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-dim">
            {playing ? "REC · RUNNING" : "STANDBY"}
          </span>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-dim/70">
          {studio.sourceName || "—"}
        </span>
        {studio.scenarioId === "real" && (
          <>
            <span className="hidden rounded border border-amber-400/50 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-amber-300 md:inline">
              real camera
            </span>
            <span className="hidden font-mono text-[8px] tracking-wider text-dim/60 lg:inline">
              {studio.sourceCredit}
            </span>
          </>
        )}
        <div className="flex-1" />
        <button
          onClick={() => studio.toggleDiagnostics()}
          title="Show what the CV engine sees: motion mask, foreground, blobs, FPS"
          className={cn(
            "flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-all",
            studio.diagnostics
              ? "border-sky-400/60 bg-sky-400/15 text-sky-300"
              : "border-line text-dim hover:border-sky-400/50 hover:text-sky-300"
          )}
        >
          <ScanEye className="h-3 w-3" />
          CV Mask
        </button>
        <button
          onClick={() => studio.setInteractionMode(studio.interactionMode === "draw" ? "select" : "draw")}
          className={cn(
            "flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-all",
            studio.interactionMode === "draw"
              ? "border-amber-400/60 bg-amber-400/15 text-amber-300"
              : "border-line text-dim hover:border-emerald-400/50 hover:text-emerald-300"
          )}
        >
          <PenLine className="h-3 w-3" />
          Draw zone
        </button>
      </div>

      {/* video plane */}
      <div
        ref={wrapRef}
        className={cn(
          "relative aspect-video w-full select-none overflow-hidden bg-obsidian",
          studio.interactionMode === "draw" ? "cursor-crosshair" : "cursor-default"
        )}
        onPointerDown={onOverlayDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        <div className="scanlines pointer-events-none absolute inset-0" />
        <div className="vignette pointer-events-none absolute inset-0" />
        {studio.diagnostics && <DiagnosticsLayer />}

        {/* ------------------------------ zones ------------------------------ */}
        {studio.zones.map((z) => {
          const phase = studio.phases[z.id] ?? "IDLE";
          const isActive = phase === "ACTIVE";
          const isArming = phase === "ARMING";
          const isCooling = phase === "COOLING";
          const selected = studio.selectedZoneId === z.id;
          const proofing = proof?.zoneId === z.id;
          return (
            <div
              key={z.id}
              className={cn("absolute touch-none", proofing && "zone-proof")}
              style={{
                left: `${z.rect.x * 100}%`,
                top: `${z.rect.y * 100}%`,
                width: `${z.rect.w * 100}%`,
                height: `${z.rect.h * 100}%`,
                border: `1.5px ${proofing ? "solid" : "dashed"} ${z.color}${z.enabled ? "D9" : "55"}`,
                backgroundColor: `${z.color}${isActive ? "22" : selected ? "14" : "09"}`,
                boxShadow: isActive
                  ? `0 0 22px ${z.color}66, inset 0 0 26px ${z.color}22`
                  : selected
                    ? `0 0 14px ${z.color}44`
                    : "none",
                cursor: "move",
                opacity: z.enabled ? 1 : 0.4,
              }}
              onPointerDown={(e) => beginZoneDrag(e, z)}
            >
              {/* label chip */}
              <div
                className="absolute -top-6 left-0 flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
                style={{ backgroundColor: `${z.color}26`, color: z.color, border: `1px solid ${z.color}55` }}
              >
                {z.name}
                {z.label !== "Custom ROI" && <span className="opacity-70">· {z.label}</span>}
                {(isActive || isArming || isCooling) && (
                  <span
                    className={cn(
                      "ml-1 rounded-sm px-1 text-[8px]",
                      isActive && "bg-emerald-400/30 text-emerald-200",
                      isArming && "bg-amber-400/30 text-amber-200",
                      isCooling && "bg-sky-400/30 text-sky-200"
                    )}
                  >
                    {isActive ? "● ACTIVE" : isArming ? "◌ ARMING" : "◍ COOLING"}
                  </span>
                )}
              </div>
              {/* corner handles */}
              {selected &&
                (["nw", "ne", "sw", "se"] as const).map((c) => (
                  <div
                    key={c}
                    onPointerDown={(e) => beginResize(e, z, c)}
                    className={cn(
                      "absolute h-2.5 w-2.5 rounded-[2px] border bg-obsidian",
                      c === "nw" && "-left-1.5 -top-1.5 cursor-nwse-resize",
                      c === "ne" && "-right-1.5 -top-1.5 cursor-nesw-resize",
                      c === "sw" && "-bottom-1.5 -left-1.5 cursor-nesw-resize",
                      c === "se" && "-bottom-1.5 -right-1.5 cursor-nwse-resize"
                    )}
                    style={{ borderColor: z.color }}
                  />
                ))}
            </div>
          );
        })}

        {/* draw preview */}
        {drawPreview && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-amber-400/80 bg-amber-400/10"
            style={{
              left: `${drawPreview.x * 100}%`,
              top: `${drawPreview.y * 100}%`,
              width: `${drawPreview.w * 100}%`,
              height: `${drawPreview.h * 100}%`,
            }}
          />
        )}

        {/* detected blobs (object-mode zones) */}
        {blobs.map((b, i) => (
          <div
            key={i}
            className="pointer-events-none absolute border border-dashed"
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
              borderColor: `${BLOB_COLORS[b.cls] ?? "#94A3B8"}B0`,
            }}
          >
            <span
              className="absolute -top-4 left-0 font-mono text-[8px] uppercase tracking-wider"
              style={{ color: BLOB_COLORS[b.cls] ?? "#94A3B8" }}
            >
              {b.cls}
            </span>
          </div>
        ))}

        {/* proof banner */}
        {proof && proofEvent && (
          <button
            onClick={() => studio.clearProof()}
            className="zone-proof-banner absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-md border border-emerald-300/70 bg-obsidian/90 px-3 py-1.5 font-mono text-[11px] text-emerald-200 backdrop-blur"
          >
            <ScanSearch className="h-3.5 w-3.5 text-emerald-300" />
            PROOF · EVENT #{proofEvent.num} · {proofEvent.zoneName} · {fmtClock(proofEvent.start)} →{" "}
            {fmtClock(proofEvent.end)} ({proofEvent.duration.toFixed(1)}s)
          </button>
        )}

        {/* manual mark chip */}
        {studio.manualMark && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-amber-400/60 bg-obsidian/90 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-300">
            <Crosshair className="h-3.5 w-3.5 animate-pulse" />
            Manual mark open · {studio.zonesFind(studio.manualMark.zoneId)?.name} · press O to close
          </div>
        )}

        {/* draw hint */}
        {studio.interactionMode === "draw" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <div className="flex items-center gap-2 rounded-md border border-amber-400/40 bg-obsidian/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-300/90">
              <SquareDashedMousePointer className="h-3.5 w-3.5" />
              Drag on the feed to draw a zone
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
