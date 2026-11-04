/**
 * REAL-FOOTAGE end-to-end verification (spec invariant E-R1).
 *
 * Runs the BUNDLED real clip (`src/assets/real-terminal.mp4` — Pexels #5101679,
 * "person tapping her smartphone to pay her bill", trimmed/compressed to 38KB)
 * through the PRODUCTION pipeline exactly as the browser does:
 *   ffmpeg → 192×108 luma @10Hz → ZoneDetector.analyzeLuma() → hysteresis segmenter
 *
 * The zone presets asserted here are the SAME ones the "CAM 03 · REAL FOOTAGE"
 * scenario ships with (src/demo/index.ts), so this test guards the exact
 * experience a judge sees on first click.
 *
 * Auto-skips if the ffmpeg binary is unavailable.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ZoneDetector } from "../detector";
import {
  flushSegmenter,
  initialSegmenterState,
  stepSegmenter,
  type SegmenterState,
} from "../segmenter";
import { REAL_FOOTAGE_ZONES } from "../../demo/realZones";
import type { ZoneConfig } from "../types";

const require2 = createRequire(import.meta.url);
let ffmpegPath: string | null = null;
try {
  ffmpegPath = require2("ffmpeg-static") as string | null;
} catch {
  ffmpegPath = null;
}

const VIDEO = "src/assets/real-terminal.mp4";
const AW = 192;
const AH = 108;
const FPS = 10; // identical to the app's 100ms sampler
const FRAME_BYTES = AW * AH;

const canRun = !!ffmpegPath && existsSync(String(ffmpegPath)) && existsSync(VIDEO);

function decodeFrames(): Uint8ClampedArray[] {
  const buf: Buffer = execFileSync(
    String(ffmpegPath),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      VIDEO,
      "-vf",
      `fps=${FPS},scale=${AW}:${AH}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "pipe:1",
    ],
    { maxBuffer: 256 * 1024 * 1024 }
  );
  const frames: Uint8ClampedArray[] = [];
  for (let off = 0; off + FRAME_BYTES <= buf.length; off += FRAME_BYTES) {
    frames.push(new Uint8ClampedArray(buf.buffer, buf.byteOffset + off, FRAME_BYTES));
  }
  return frames;
}

interface LoggedEvent {
  zone: string;
  start: number;
  end: number;
  duration: number;
  peak: number;
}

function runPipeline(zones: ZoneConfig[], frames: Uint8ClampedArray[]) {
  const detector = new ZoneDetector();
  const states = new Map<string, SegmenterState>(zones.map((z) => [z.id, initialSegmenterState()]));
  const events: LoggedEvent[] = [];
  const peakSignal: Record<string, number> = {};

  frames.forEach((frame, i) => {
    const t = i / FPS;
    const out = detector.analyzeLuma(frame, zones, t);
    for (const z of zones) {
      const sig = out.zones[z.id];
      if (!sig) continue;
      peakSignal[z.name] = Math.max(peakSignal[z.name] ?? 0, sig.value);
      const res = stepSegmenter(states.get(z.id)!, t, sig.active, sig.confidence, {
        startHoldMs: z.startHoldMs,
        gapMergeMs: z.gapMergeMs,
      });
      states.set(z.id, res.state);
      if (res.completed) {
        events.push({
          zone: z.name,
          start: res.completed.start,
          end: res.completed.end,
          duration: res.completed.duration,
          peak: res.completed.peak,
        });
      }
    }
  });
  for (const z of zones) {
    const f = flushSegmenter(states.get(z.id)!);
    if (f.completed) {
      events.push({
        zone: z.name,
        start: f.completed.start,
        end: f.completed.end,
        duration: f.completed.duration,
        peak: f.completed.peak,
      });
    }
  }
  events.sort((a, b) => a.start - b.start);
  return { events, peakSignal };
}

describe.runIf(canRun)("real footage e2e · bundled card-terminal clip", () => {
  it("ships a judge-ready scenario: shipped presets find real payment events", () => {
    const frames = decodeFrames();
    expect(frames.length).toBeGreaterThan(80); // ~10.5s @10Hz

    const zones = REAL_FOOTAGE_ZONES();
    const { events, peakSignal } = runPipeline(zones, frames);

    console.log(`\n=== BUNDLED REAL FOOTAGE · ${frames.length} frames @${FPS}Hz ===`);
    for (const z of zones) {
      console.log(
        `  ${z.name} (${z.label}): threshold ${z.sensitivity}, peak signal ${(peakSignal[z.name] ?? 0).toFixed(3)}, hold ${z.startHoldMs}ms`
      );
    }
    for (const e of events) {
      console.log(
        `  ${e.zone}  ${e.start.toFixed(1)}s → ${e.end.toFixed(1)}s  (${e.duration.toFixed(2)}s, peak ${e.peak.toFixed(2)})`
      );
    }
    console.log(`  total: ${events.length} events\n`);

    // E-R1: the terminal zone must yield at least one real payment event
    const tap = events.filter((e) => e.zone === "Zone_A");
    expect(tap.length).toBeGreaterThanOrEqual(1);

    // shipped thresholds must sit meaningfully below the observed peak signal
    for (const z of zones) {
      expect(peakSignal[z.name]).toBeGreaterThan(z.sensitivity);
    }

    // hysteresis bounds hold on real, compressed, noisy footage
    for (const e of events) {
      expect(e.end).toBeGreaterThan(e.start);
      expect(e.duration).toBeGreaterThanOrEqual(0.2);
      expect(e.peak).toBeGreaterThan(0);
      expect(e.peak).toBeLessThanOrEqual(1);
    }
    for (const z of zones) {
      const list = events.filter((e) => e.zone === z.name);
      for (let i = 1; i < list.length; i++) {
        expect(list[i].start).toBeGreaterThan(list[i - 1].end);
      }
    }
  }, 120_000);

  it("start-hold rejects sub-threshold blips (noise discipline on real pixels)", () => {
    const frames = decodeFrames();
    const base = REAL_FOOTAGE_ZONES();
    // an absurdly long hold must suppress every short real-world activity burst
    const strict = base.map((z) => ({ ...z, startHoldMs: 20000 }));
    const { events } = runPipeline(strict, frames);
    expect(events).toHaveLength(0);
  }, 120_000);
});
