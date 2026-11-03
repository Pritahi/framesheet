/**
 * FrameSheet — detection runner.
 *
 * Owns the 10Hz sampling loop: pulls the current frame from the active source,
 * runs the dual-mode detector, pushes zone signals through the hysteresis
 * segmenter, and reports started/completed segments to the studio store.
 * Also enforces Click-to-Proof auto-stop at the end of a proofed segment.
 */

import { ZoneDetector } from "./detector";
import {
  flushSegmenter,
  initialSegmenterState,
  stepSegmenter,
  type SegmenterState,
} from "./segmenter";
import type { FrameEvent } from "./types";
import { studio, telemetry, type Studio } from "../store";

const SAMPLE_MS = 100;

export class DetectionRunner {
  private detector = new ZoneDetector();
  private states = new Map<string, SegmenterState>();
  private timer: number | null = null;
  private offs: (() => void)[] = [];
  /* diagnostics telemetry */
  private costEma = 0;
  private fps = 0;
  private fpsAnchor = performance.now();
  private sampleCount = 0;

  constructor(private st: Studio) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.sample(), SAMPLE_MS);
    this.offs.push(
      this.st.on("seeked", () => this.onSeek()),
      this.st.on("sourceChanged", () => this.onSourceChanged()),
      this.st.on("paused", () => this.flushAll()),
      this.st.on("ended", () => this.flushAll())
    );
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.offs.forEach((off) => off());
    this.offs = [];
  }

  private onSeek(): void {
    this.flushAll();
    this.states.clear();
    this.detector.resetTemporal();
  }

  private onSourceChanged(): void {
    this.states.clear();
    this.detector.reset();
  }

  private flushAll(): void {
    for (const [zoneId, state] of [...this.states.entries()]) {
      const { state: next, completed } = flushSegmenter(state);
      this.states.set(zoneId, next);
      if (completed) this.emitSegment(zoneId, completed);
      this.st.liveClear(zoneId);
    }
  }

  private emitSegment(
    zoneId: string,
    seg: { start: number; end: number; duration: number; peak: number }
  ): void {
    const zone = this.st.zonesFind(zoneId);
    if (!zone) return;
    const ev = this.st.addEvent({
      zoneId,
      mode: zone.mode === "motion" ? "MOTION" : "OBJECT",
      start: seg.start,
      end: seg.end,
      peak: seg.peak,
    });
    if (ev && seg.duration >= this.st.bottleneckAt) {
      this.st.toast(
        `BOTTLENECK captured: ${ev.zoneName} #${ev.num} ran ${seg.duration.toFixed(1)}s`,
        "err"
      );
    }
  }

  private sample(): void {
    const st = this.st;
    const src = st.source;
    if (!src || !src.playing) return;
    const t = src.currentTime;

    // Click-to-proof: auto-stop at the end of the evidence segment
    if (st.proof && t >= st.proof.end + 0.05) {
      src.pause();
      const proof = st.proof;
      window.setTimeout(() => {
        if (studio.proof === proof) studio.clearProof();
      }, 1400);
    }

    const zones = st.zones.filter((z) => z.enabled);
    const t0 = performance.now();
    const frame = this.detector.analyze(
      (ctx, w, h) => src.renderInto(ctx, w, h),
      zones,
      t,
      st.diagnostics
    );
    const costMs = performance.now() - t0;

    // telemetry side-channel (10Hz, no structural store bump)
    const values: Record<string, { value: number; active: boolean; threshold: number; conf: number }> = {};
    for (const z of zones) {
      const sig = frame.zones[z.id];
      if (!sig) continue;
      values[z.id] = {
        value: sig.value,
        active: sig.active,
        conf: sig.confidence,
        threshold: z.mode === "motion" ? z.sensitivity : z.overlap,
      };
    }
    // rolling detector cost → effective FPS headroom readout
    this.costEma = this.costEma === 0 ? costMs : this.costEma * 0.85 + costMs * 0.15;
    this.sampleCount++;
    const now = performance.now();
    if (now - this.fpsAnchor >= 1000) {
      this.fps = (this.sampleCount * 1000) / (now - this.fpsAnchor);
      this.sampleCount = 0;
      this.fpsAnchor = now;
    }

    telemetry.emit({
      t,
      values,
      blobs: frame.blobs,
      fps: this.fps,
      costMs: this.costEma,
      mask: frame.debugMask,
      maskW: frame.debugW,
      maskH: frame.debugH,
    });
    st.lastSignal = { t, values };
    (st as unknown as { lastBlobs?: unknown }).lastBlobs = frame.blobs;

    // phase telemetry + segmenter stepping
    let phasesChanged = false;
    for (const z of zones) {
      const sig = frame.zones[z.id];
      if (!sig) continue;
      const prev = this.states.get(z.id) ?? initialSegmenterState();
      const out = stepSegmenter(prev, t, sig.active, sig.confidence, {
        startHoldMs: z.startHoldMs,
        gapMergeMs: z.gapMergeMs,
      });
      this.states.set(z.id, out.state);
      if (st.phases[z.id] !== out.state.phase) {
        st.phases = { ...st.phases, [z.id]: out.state.phase };
        phasesChanged = true;
      }
      if (out.started) {
        st.liveStart(z.id, out.started.start, z.mode === "motion" ? "MOTION" : "OBJECT");
      }
      if (out.state.phase === "ACTIVE") {
        st.livePeak(z.id, out.state.peak);
      }
      if (out.completed) {
        this.emitSegment(z.id, out.completed);
      }
    }
    if (phasesChanged) st.bumpPhases();
  }
}

/** Manual marking ("I"/"O" keys) inserts an operator override segment. */
export function emitManualSegment(
  st: Studio,
  zoneId: string,
  start: number,
  end: number
): FrameEvent | null {
  return st.addEvent({ zoneId, mode: "MANUAL", start, end, peak: 1 });
}
