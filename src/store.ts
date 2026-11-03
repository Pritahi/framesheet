/**
 * FrameSheet — central studio store (framework-agnostic singleton + React glue).
 *
 * The store owns: the active frame source, zone configs, the event log,
 * live (in-progress) segments, the summary sheet, proof playback state,
 * threshold settings and toasts. A monotonically increasing `version` is
 * bumped on every structural mutation; React binds via useSyncExternalStore.
 * High-frequency signals (per-sample detector telemetry, playback clock) travel
 * on side channels so only the telemetry widgets re-render at 10Hz.
 */

import { useSyncExternalStore } from "react";
import type { FrameSource } from "./engine/source";
import { ProceduralSource, VideoFileSource } from "./engine/source";
import { getScenario, uploadZones, REAL_FOOTAGE, REAL_FOOTAGE_ZONES, type ScenarioId } from "./demo";
import realClipUrl from "./assets/real-terminal.mp4?inline";
import {
  ZONE_COLORS,
  type FrameEvent,
  type ObjectClass,
  type VerifyState,
  type ZoneConfig,
  type ZoneMode,
} from "./engine/types";
import type { SegmenterPhase } from "./engine/segmenter";
import { clamp } from "./engine/time";

export interface LiveSegment {
  zoneId: string;
  start: number;
  peak: number;
  mode: "MOTION" | "OBJECT" | "MANUAL";
}

export interface ProofState {
  eventId: string;
  zoneId: string;
  start: number;
  end: number;
  label: string;
  startedAt: number; // perf clock ms
}

export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "warn" | "err";
}

export interface SheetCell {
  addr: string;
  raw: string;
}

const SHEET_COLS = ["A", "B", "C", "D"] as const;
const SHEET_ROWS = [1, 2, 3, 4, 5, 6] as const;
export const SHEET_ADDRS: string[] = SHEET_ROWS.flatMap((r) => SHEET_COLS.map((c) => `${c}${r}`));

export function defaultSheet(): Record<string, string> {
  return {
    A1: "METRIC",
    B1: "ZONE_A",
    C1: "ZONE_B",
    D1: "ALERT",
    A2: "EVENTS",
    B2: '=COUNT_EVENTS("Zone_A")',
    C2: '=COUNT_EVENTS("Zone_B")',
    A3: "AVG DUR (s)",
    B3: '=AVG_DURATION("Zone_A")',
    C3: '=AVG_DURATION("Zone_B")',
    A4: "MAX DUR (s)",
    B4: '=MAX_DURATION("Zone_A")',
    C4: '=MAX_DURATION("Zone_B")',
    A5: "OVER 20s",
    B5: '=COUNT_OVER("Zone_A", 20)',
    C5: '=COUNT_OVER("Zone_B", 20)',
    A6: "VERDICT",
    B6: '=IF(B4 > 25, "BOTTLENECK ALERT", "NORMAL")',
    C6: '=IF(C4 > 25, "BOTTLENECK ALERT", "NORMAL")',
    D6: '=SUM_DURATION("Zone_A")',
  };
}

type StudioEvent =
  | "seeked"
  | "sourceChanged"
  | "paused"
  | "ended"
  | "played";

export class Studio {
  /* playback */
  source: FrameSource | null = null;
  scenarioId: ScenarioId | "upload" | "real" = "retail";
  sourceName = "";
  /** attribution line for bundled third-party footage */
  sourceCredit = "";

  /* detection config + results */
  zones: ZoneConfig[] = [];
  events: FrameEvent[] = [];
  live: Record<string, LiveSegment> = {};
  /** per-zone segmenter phase telemetry (IDLE/ARMING/ACTIVE/COOLING) */
  phases: Record<string, SegmenterPhase> = {};
  /** last sampled detector signals (debug/diagnostics handle) */
  lastSignal: { t: number; values: Record<string, { value: number; active: boolean }> } | null = null;

  /* sheet */
  sheet: Record<string, string> = defaultSheet();
  selectedCell = "B4";

  /* classification thresholds */
  slowAt = 20;
  bottleneckAt = 25;

  /* proof playback */
  proof: ProofState | null = null;

  /* human-in-the-loop manual marking (I / O keys) */
  manualMark: { zoneId: string; start: number } | null = null;

  /* ui */
  interactionMode: "select" | "draw" = "select";
  selectedZoneId: string | null = null;
  toasts: Toast[] = [];
  /** CV diagnostics overlay (mask + blobs + FPS HUD) */
  diagnostics = false;
  /** zone currently being auto-calibrated */
  calibratingZoneId: string | null = null;

  version = 0;
  private listeners = new Set<() => void>();
  private eventBus = new Map<StudioEvent, Set<() => void>>();
  private toastSeq = 1;
  private eventSeq = 1;

  /* ------------------------------- plumbing -------------------------------- */

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  on(ev: StudioEvent, cb: () => void): () => void {
    if (!this.eventBus.has(ev)) this.eventBus.set(ev, new Set());
    this.eventBus.get(ev)!.add(cb);
    return () => this.eventBus.get(ev)!.delete(cb);
  }
  private fire(ev: StudioEvent): void {
    this.eventBus.get(ev)?.forEach((cb) => cb());
  }
  bump(): void {
    this.version++;
    for (const cb of this.listeners) cb();
  }

  bumpPhases(): void {
    this.bump();
  }

  zonesFind(id: string): ZoneConfig | undefined {
    return this.zones.find((z) => z.id === id);
  }

  /** Operator override: open a manual mark on the selected zone. */
  markStart(): void {
    if (this.manualMark || !this.source) return;
    const zid = this.selectedZoneId ?? this.zones[0]?.id;
    if (!zid) return;
    this.manualMark = { zoneId: zid, start: this.source.currentTime };
    const z = this.zonesFind(zid);
    this.toast(`Manual mark IN · ${z?.name ?? zid}`, "warn");
    this.bump();
  }

  /** Operator override: close the manual mark into a MANUAL event. */
  markEnd(): void {
    if (!this.manualMark || !this.source) return;
    const { zoneId, start } = this.manualMark;
    const end = this.source.currentTime;
    this.manualMark = null;
    if (end - start < 0.3) {
      this.toast("Manual mark too short (<0.3s) — discarded", "warn");
    } else {
      const ev = this.addEvent({ zoneId, mode: "MANUAL", start, end, peak: 1 });
      if (ev) this.toast(`Manual event saved · ${ev.zoneName} #${ev.num}`);
    }
    this.bump();
  }

  toast(text: string, tone: Toast["tone"] = "ok"): void {
    const id = this.toastSeq++;
    this.toasts = [...this.toasts.slice(-3), { id, text, tone }];
    this.bump();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.bump();
    }, 3400);
  }

  /* --------------------------- source management --------------------------- */

  initScenario(id: ScenarioId): void {
    if (this.source && this.scenarioId === id) {
      // re-clicking the active scenario = clean restart with a fresh bg model
      this.events = [];
      this.live = {};
      this.phases = {};
      this.proof = null;
      this.manualMark = null;
      this.eventSeq = 1;
      this.source.seek(0);
      this.fire("sourceChanged");
      this.bump();
      this.toast(`${this.sourceName} restarted — event log cleared`);
      return;
    }
    this.source?.dispose();
    const scenario = getScenario(id);
    this.source = new ProceduralSource(scenario.scene);
    this.scenarioId = id;
    this.sourceName = scenario.scene.title;
    this.sourceCredit = "";
    this.zones = scenario.makeZones();
    this.events = [];
    this.live = {};
    this.phases = {};
    this.proof = null;
    this.manualMark = null;
    this.eventSeq = 1;
    this.selectedZoneId = this.zones[0]?.id ?? null;
    this.wireSource();
    this.fire("sourceChanged");
    this.bump();
  }

  /** 4th feed: the bundled REAL camera clip, pre-tuned for judges. */
  initRealFootage(): void {
    const restart = this.scenarioId === "real" && this.source;
    if (restart) {
      this.events = [];
      this.live = {};
      this.phases = {};
      this.proof = null;
      this.manualMark = null;
      this.eventSeq = 1;
      this.source!.seek(0);
      this.fire("sourceChanged");
      this.bump();
      this.source!.play();
      return;
    }
    this.source?.dispose();
    this.source = new VideoFileSource(realClipUrl);
    this.scenarioId = "real";
    this.sourceName = REAL_FOOTAGE.title;
    this.sourceCredit = REAL_FOOTAGE.credit;
    this.zones = REAL_FOOTAGE_ZONES();
    this.events = [];
    this.live = {};
    this.phases = {};
    this.proof = null;
    this.manualMark = null;
    this.eventSeq = 1;
    this.selectedZoneId = this.zones[0]?.id ?? null;
    this.wireSource();
    this.fire("sourceChanged");
    this.bump();
    this.toast("Real camera footage loaded — zones pre-tuned (Quick Tap preset)");
    this.waitAndPlay();
  }

  private waitAndPlay(): void {
    const tryPlay = window.setInterval(() => {
      if (this.source && this.source.duration > 0) {
        this.source.play();
        window.clearInterval(tryPlay);
      }
    }, 120);
    window.setTimeout(() => window.clearInterval(tryPlay), 6000);
  }

  loadFile(file: File): void {
    this.source?.dispose();
    this.source = new VideoFileSource(file);
    this.scenarioId = "upload";
    this.sourceName = file.name;
    this.sourceCredit = "";
    this.zones = uploadZones();
    this.events = [];
    this.live = {};
    this.phases = {};
    this.proof = null;
    this.manualMark = null;
    this.eventSeq = 1;
    this.selectedZoneId = this.zones[0]?.id ?? null;
    this.wireSource();
    this.fire("sourceChanged");
    this.bump();
    this.toast(`Loaded ${file.name} — press play, motion mode works on any feed`);
    // auto-play as soon as metadata is ready
    const tryPlay = window.setInterval(() => {
      if (this.source && this.source.duration > 0) {
        this.source.play();
        window.clearInterval(tryPlay);
      }
    }, 150);
    window.setTimeout(() => window.clearInterval(tryPlay), 5000);
  }

  private wireSource(): void {
    const src = this.source;
    if (!src) return;
    let wasPlaying = false;
    let lastT = 0;
    src.subscribe(() => {
      const playing = src.playing;
      const t = src.currentTime;
      if (playing && !wasPlaying) this.fire("played");
      if (!playing && wasPlaying) this.fire(src.currentTime >= src.duration - 0.001 ? "ended" : "paused");
      // seek detection: big jump not explained by normal playback
      if (Math.abs(t - lastT) > 1.2 && wasPlaying) this.fire("seeked");
      if (!playing && Math.abs(t - lastT) > 0.001) this.fire("seeked");
      wasPlaying = playing;
      lastT = t;
    });
  }

  requestSeek(t: number): void {
    if (!this.source) return;
    this.source.seek(clamp(t, 0, this.source.duration));
    this.bump();
  }

  /* ------------------------------ zone actions ----------------------------- */

  addZone(rect: { x: number; y: number; w: number; h: number }): ZoneConfig {
    const idx = this.zones.length;
    const letter = String.fromCharCode("A".charCodeAt(0) + (idx % 26));
    const z: ZoneConfig = {
      id: `z${Date.now().toString(36)}${idx}`,
      name: `Zone_${letter}`,
      label: "Custom ROI",
      color: ZONE_COLORS[idx % ZONE_COLORS.length],
      rect,
      mode: "motion",
      targetClass: "person",
      sensitivity: 0.08,
      overlap: 0.45,
      startHoldMs: 800,
      gapMergeMs: 1500,
      enabled: true,
    };
    this.zones = [...this.zones, z];
    this.selectedZoneId = z.id;
    this.bump();
    return z;
  }

  updateZone(id: string, patch: Partial<ZoneConfig>): void {
    const before = this.zones.find((z) => z.id === id);
    this.zones = this.zones.map((z) => (z.id === id ? { ...z, ...patch } : z));
    // keep event-zone name links coherent when a zone is renamed
    if (before && patch.name && patch.name !== before.name) {
      this.events = this.events.map((e) =>
        e.zoneId === id ? { ...e, zoneName: patch.name! } : e
      );
    }
    this.bump();
  }

  removeZone(id: string): void {
    this.zones = this.zones.filter((z) => z.id !== id);
    if (this.selectedZoneId === id) this.selectedZoneId = this.zones[0]?.id ?? null;
    this.bump();
  }

  setSelectedZone(id: string | null): void {
    this.selectedZoneId = id;
    this.bump();
  }

  setInteractionMode(m: "select" | "draw"): void {
    this.interactionMode = m;
    this.bump();
  }

  toggleDiagnostics(): void {
    this.diagnostics = !this.diagnostics;
    this.bump();
    this.toast(
      this.diagnostics
        ? "CV diagnostics ON — green = motion pixels, blue = foreground mask"
        : "CV diagnostics off"
    );
  }

  /**
   * Area-aware Auto-Calibrate: samples ~1.6s of live detector signal for one
   * zone, takes the observed noise ceiling and sets the threshold just above it
   * (noise p90 × 1.8, floored at 0.02). Larger zones dilute a local action, so
   * sampling the actual zone — not a constant — is what makes this area-aware.
   */
  autoCalibrate(zoneId: string, subscribeTelemetry: (cb: (v: number) => void) => () => void): void {
    const zone = this.zonesFind(zoneId);
    if (!zone) return;
    if (!this.source?.playing) {
      this.toast("Press play first — calibration samples the live feed", "warn");
      return;
    }
    if (this.calibratingZoneId) return;
    this.calibratingZoneId = zoneId;
    this.bump();
    this.toast(`Calibrating ${zone.name} — hold the scene idle for ~1.6s`, "warn");

    const samples: number[] = [];
    const off = subscribeTelemetry((v) => samples.push(v));
    window.setTimeout(() => {
      off();
      this.calibratingZoneId = null;
      if (samples.length < 4) {
        this.toast("Not enough samples — is the feed playing?", "err");
        this.bump();
        return;
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
      const isMotion = zone.mode === "motion";
      const next = isMotion
        ? clamp(Math.max(0.02, p90 * 1.8), 0.02, 0.3)
        : clamp(Math.max(0.15, p90 * 1.4), 0.1, 0.9);
      const rounded = Math.round(next * 1000) / 1000;
      this.updateZone(zoneId, isMotion ? { sensitivity: rounded } : { overlap: rounded });
      this.toast(
        `${zone.name} calibrated → ${isMotion ? "sensitivity" : "occupancy"} ${(rounded * 100).toFixed(1)}% (noise p90 ${(p90 * 100).toFixed(1)}%)`
      );
    }, 1600);
  }

  /** One-click detection presets tuned from the real-footage trials. */
  applyPreset(zoneId: string, preset: "quick" | "standard" | "dwell"): void {
    const zone = this.zonesFind(zoneId);
    if (!zone) return;
    const table = {
      quick: { startHoldMs: 300, sensitivity: 0.05, gapMergeMs: 1000, overlap: 0.3 },
      standard: { startHoldMs: 800, sensitivity: 0.08, gapMergeMs: 1500, overlap: 0.45 },
      dwell: { startHoldMs: 1200, sensitivity: 0.1, gapMergeMs: 2500, overlap: 0.55 },
    } as const;
    const p = table[preset];
    this.updateZone(zoneId, {
      startHoldMs: p.startHoldMs,
      gapMergeMs: p.gapMergeMs,
      sensitivity: p.sensitivity,
      overlap: p.overlap,
    });
    const names = { quick: "Quick Tap", standard: "Standard Cycle", dwell: "Long Dwell" };
    this.toast(`${zone.name} → ${names[preset]} preset applied`);
  }

  /* ------------------------------ event intake ----------------------------- */

  liveStart(zoneId: string, start: number, mode: LiveSegment["mode"]): void {
    const z = this.zones.find((zz) => zz.id === zoneId);
    this.live = { ...this.live, [zoneId]: { zoneId, start, peak: 0, mode: z ? mode : mode } };
    this.bump();
  }

  livePeak(zoneId: string, peak: number): void {
    const cur = this.live[zoneId];
    if (cur && peak > cur.peak) {
      this.live = { ...this.live, [zoneId]: { ...cur, peak } };
    }
    // no bump — included with completion; live UI reads imperatively
  }

  liveClear(zoneId: string): void {
    if (this.live[zoneId]) {
      const next = { ...this.live };
      delete next[zoneId];
      this.live = next;
      this.bump();
    }
  }

  /** Insert a completed segment with overlap de-duplication (proof replays
   *  re-detect the same activity — those are folded away). */
  addEvent(input: {
    zoneId: string;
    mode: FrameEvent["mode"];
    start: number;
    end: number;
    peak: number;
  }): FrameEvent | null {
    const zone = this.zones.find((z) => z.id === input.zoneId);
    if (!zone) return null;
    const start = Math.max(0, input.start);
    const end = Math.max(start + 0.05, input.end);
    const duration = end - start;
    const dup = this.events.some((e) => {
      if (e.zoneId !== input.zoneId || e.verified === "DISMISSED") return false;
      const inter = Math.max(0, Math.min(e.end, end) - Math.max(e.start, start));
      const union = Math.max(e.end, end) - Math.min(e.start, start);
      return union > 0 && inter / union > 0.45;
    });
    if (dup) return null;
    const ev: FrameEvent = {
      id: `ev${this.eventSeq++}`,
      num: 0,
      zoneId: input.zoneId,
      zoneName: zone.name,
      zoneLabel: zone.label,
      color: zone.color,
      mode: input.mode,
      start,
      end,
      duration,
      peak: Math.min(1, Math.max(0, input.peak)),
      verified: "AUTO",
    };
    this.events = [...this.events, ev].sort((a, b) => a.start - b.start);
    this.events = this.events.map((e, i) => ({ ...e, num: i + 1 }));
    delete this.live[input.zoneId];
    this.bump();
    return ev;
  }

  setVerified(id: string, v: VerifyState): void {
    this.events = this.events.map((e) => (e.id === id ? { ...e, verified: v } : e));
    this.bump();
  }

  editEvent(id: string, start: number, end: number): void {
    const s = clamp(Math.min(start, end), 0, Infinity);
    const en = Math.max(start, end);
    this.events = this.events
      .map((e) =>
        e.id === id
          ? { ...e, start: s, end: en, duration: Math.max(0.05, en - s), verified: "EDITED" as const }
          : e
      )
      .sort((a, b) => a.start - b.start)
      .map((e, i) => ({ ...e, num: i + 1 }));
    this.bump();
  }

  deleteEvent(id: string): void {
    this.events = this.events
      .filter((e) => e.id !== id)
      .sort((a, b) => a.start - b.start)
      .map((e, i) => ({ ...e, num: i + 1 }));
    this.bump();
  }

  /* --------------------------------- proof --------------------------------- */

  prove(eventId: string): void {
    const ev = this.events.find((e) => e.id === eventId);
    if (!ev || !this.source) return;
    this.proof = {
      eventId: ev.id,
      zoneId: ev.zoneId,
      start: ev.start,
      end: ev.end,
      label: `PROOF · EVENT #${ev.num} · ${ev.zoneName}`,
      startedAt: performance.now(),
    };
    this.source.seek(Math.max(0, ev.start - 0.12));
    this.source.play();
    this.toast(`Click-to-proof: replaying ${ev.zoneName} event #${ev.num}`);
    this.bump();
  }

  /** For COUNT_OVER-style cells: prove the LONGEST matching event. */
  proveFromEvents(ids: string[]): void {
    if (!ids.length) return;
    let best: FrameEvent | null = null;
    for (const id of ids) {
      const e = this.events.find((ev) => ev.id === id);
      if (e && (!best || e.duration > best.duration)) best = e;
    }
    if (best) this.prove(best.id);
    else this.toast("No evidence events match this cell yet", "warn");
  }

  clearProof(): void {
    if (this.proof) {
      this.proof = null;
      this.bump();
    }
  }

  /* --------------------------------- sheet --------------------------------- */

  setCell(addr: string, raw: string): void {
    this.sheet = { ...this.sheet, [addr]: raw };
    this.bump();
  }

  setSelectedCell(addr: string): void {
    this.selectedCell = addr;
    this.bump();
  }

  setThresholds(slowAt: number, bottleneckAt: number): void {
    this.slowAt = clamp(slowAt, 1, 600);
    this.bottleneckAt = clamp(Math.max(bottleneckAt, slowAt), 1, 900);
    this.bump();
  }
}

export const studio = new Studio();

/** React hook: re-render on every structural studio mutation. */
export function useStudioVersion(): number {
  return useSyncExternalStore(studio.subscribe, () => studio.version);
}

/* ------------------------------ high-frequency ------------------------------ */
/** 10Hz detector telemetry ring — components subscribe imperatively. */
export interface TelemetryFrame {
  t: number;
  values: Record<string, { value: number; active: boolean; threshold: number; conf: number }>;
  blobs: { x: number; y: number; w: number; h: number; cls: string; area: number }[];
  /** detector loop rate (samples/sec) */
  fps: number;
  /** rolling per-sample detector cost in ms */
  costMs: number;
  /** diagnostics CV mask: 0 static · 1 motion · 2 foreground · 3 both */
  mask?: Uint8Array;
  maskW?: number;
  maskH?: number;
}
export const telemetry = {
  listeners: new Set<(f: TelemetryFrame) => void>(),
  emit(f: TelemetryFrame): void {
    this.listeners.forEach((cb) => cb(f));
  },
  subscribe(cb: (f: TelemetryFrame) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  },
};

export type { ZoneMode, ObjectClass };
