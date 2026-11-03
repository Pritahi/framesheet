/**
 * FrameSheet — dual-mode on-device detection engine (zero network, zero APIs).
 *
 * Mode 1 · MOTION (frame-diff):  normalized mean absolute pixel change inside
 *          a zone rectangle between consecutive samples. Works on ANY video.
 *
 * Mode 2 · OBJECT (blob tracker): foreground mask vs a slowly-adapting
 *          background model → 3×3 dilation → connected-component labeling →
 *          size/aspect classification (person / vehicle / package) → centroid
 *          track matching with background-anchor freezing so dwellers that
 *          stop moving are NOT absorbed into the background.
 *
 * Both modes emit a per-zone signal {active, confidence, value} that feeds the
 * pure hysteresis segmenter. All math runs on a 192×108 analysis frame, which
 * keeps each sample well under 1ms on commodity hardware.
 */

import type { ObjectClass, ZoneConfig } from "./types";

export interface ZoneSignal {
  active: boolean;
  confidence: number;
  /** raw signal: motion intensity (0..1) or occupancy ratio (0..1) */
  value: number;
}

export interface BlobInfo {
  /** normalized 0..1 */
  x: number;
  y: number;
  w: number;
  h: number;
  cls: ObjectClass;
  area: number;
}

export interface DetectorFrame {
  zones: Record<string, ZoneSignal>;
  blobs: BlobInfo[];
  /** Diagnostics only: 192×108 per-pixel class map.
   *  0 = static · 1 = motion (frame-diff) · 2 = foreground (bg-model) · 3 = both */
  debugMask?: Uint8Array;
  debugW?: number;
  debugH?: number;
}

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Track {
  id: number;
  bbox: BBox;
  cls: ObjectClass;
  area: number;
  lastSeen: number;
  matched: boolean;
}

interface Release {
  bbox: BBox;
  until: number;
}

const AW = 192;
const AH = 108;
const FG_THRESHOLD = 26; // grayscale 0..255, above the 5% flicker floor (≈12)
const MIN_BLOB_AREA = 40; // px @ 192×108
const MATCH_DIST = 30; // px @ 192×108
const TRACK_TTL = 3.0; // seconds a track survives without a fresh blob
const ANCHOR_HOLD = 0.8; // seconds after last blob where bg stays frozen

export class ZoneDetector {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private bg: Float32Array | null = null;
  private prev: Uint8ClampedArray | null = null;
  private flags: Uint8Array = new Uint8Array(AW * AH); // 0 normal · 1 frozen · 2 release
  private tracks: Track[] = [];
  private releases: Release[] = [];
  private nextTrackId = 1;

  constructor() {
    // canvas is created lazily — analyzeLuma() works in Node with no DOM
  }

  private getCtx(): CanvasRenderingContext2D {
    if (this.ctx) return this.ctx;
    if (typeof document === "undefined") {
      throw new Error("analyze(drawFrame) needs a browser DOM; use analyzeLuma in Node");
    }
    this.canvas = document.createElement("canvas");
    this.canvas.width = AW;
    this.canvas.height = AH;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    return ctx;
  }

  /** Full reset — call on scenario / source change. */
  reset(): void {
    this.bg = null;
    this.prev = null;
    this.tracks = [];
    this.releases = [];
  }

  /** Soft reset — call on seeks (previous-frame diff would be garbage once). */
  resetTemporal(): void {
    this.prev = null;
  }

  private zonePx(rect: { x: number; y: number; w: number; h: number }): BBox {
    const x = Math.max(0, Math.round(rect.x * AW));
    const y = Math.max(0, Math.round(rect.y * AH));
    const w = Math.min(AW - x, Math.round(rect.w * AW));
    const h = Math.min(AH - y, Math.round(rect.h * AH));
    return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
  }

  analyze(
    drawFrame: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    zones: ZoneConfig[],
    tSec: number,
    debug = false
  ): DetectorFrame {
    const ctx = this.getCtx();
    drawFrame(ctx, AW, AH);
    const img = ctx.getImageData(0, 0, AW, AH).data;
    const n = AW * AH;
    const cur = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      // integer luma approximation
      cur[i] = (img[j] * 77 + img[j + 1] * 151 + img[j + 2] * 28) >> 8;
    }
    return this.analyzeLuma(cur, zones, tSec, debug);
  }

  /**
   * Pure frame pipeline on a pre-computed 192×108 luma plane.
   * Canvas-free and Node-safe — this is what the real-footage e2e test feeds.
   */
  analyzeLuma(
    cur: Uint8ClampedArray,
    zones: ZoneConfig[],
    tSec: number,
    debug = false
  ): DetectorFrame {
    const n = AW * AH;
    // warm-up: first frame seeds background, no signal
    if (!this.bg || !this.prev) {
      this.bg = Float32Array.from(cur);
      this.prev = cur;
      const neutral: Record<string, ZoneSignal> = {};
      for (const z of zones) neutral[z.id] = { active: false, confidence: 0, value: 0 };
      return { zones: neutral, blobs: [] };
    }
    // diagnostics layer: per-pixel classification for the CV mask overlay
    const dbg = debug ? new Uint8Array(n) : null;

    const bg = this.bg;
    const prevFrame = this.prev;

    /* ------------------------------ motion mode ----------------------------- */
    // Active-pixel fraction: pct of zone pixels whose frame-to-frame change
    // exceeds the noise gate. Gating kills sensor flicker entirely (global 5%
    // light flicker ≈ 12 luma < gate → exactly zero changed pixels), while
    // moving bodies change 10-30% of zone pixels.
    const outZones: Record<string, ZoneSignal> = {};
    const MOTION_GATE = 18;
    if (dbg) {
      // whole-frame motion layer so the overlay shows activity outside zones too
      for (let i = 0; i < n; i++) {
        if (Math.abs(cur[i] - prevFrame[i]) > MOTION_GATE) dbg[i] |= 1;
      }
    }
    for (const z of zones) {
      if (z.mode !== "motion") continue;
      const r = this.zonePx(z.rect);
      let changed = 0;
      let count = 0;
      for (let yy = r.y; yy < r.y + r.h; yy++) {
        const row = yy * AW;
        for (let xx = r.x; xx < r.x + r.w; xx++) {
          if (Math.abs(cur[row + xx] - prevFrame[row + xx]) > MOTION_GATE) changed++;
          count++;
        }
      }
      const value = count > 0 ? changed / count : 0;
      const active = value >= z.sensitivity;
      const confidence = active ? Math.min(1, value / (z.sensitivity * 2.2)) : Math.min(1, value / Math.max(1e-6, z.sensitivity));
      outZones[z.id] = { active, confidence, value };
    }

    /* --------------------------- object mode: mask -------------------------- */
    // diagnostics forces the foreground pipeline on so the mask is always shown
    const needsObjects = zones.some((z) => z.mode === "object") || !!dbg;
    if (needsObjects) {
      // foreground mask vs background
      let mask = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        mask[i] = Math.abs(cur[i] - bg[i]) > FG_THRESHOLD ? 1 : 0;
      }
      // 3×3 dilation to fuse body parts
      const dil = new Uint8Array(n);
      for (let y = 1; y < AH - 1; y++) {
        for (let x = 1; x < AW - 1; x++) {
          const i = y * AW + x;
          if (
            mask[i] ||
            mask[i - 1] ||
            mask[i + 1] ||
            mask[i - AW] ||
            mask[i + AW] ||
            mask[i - AW - 1] ||
            mask[i - AW + 1] ||
            mask[i + AW - 1] ||
            mask[i + AW + 1]
          ) {
            dil[i] = 1;
          }
        }
      }
      mask = dil;
      if (dbg) {
        for (let i = 0; i < n; i++) if (mask[i]) dbg[i] |= 2;
      }

      // connected components (iterative flood fill)
      const visited = new Uint8Array(n);
      const blobs: { bbox: BBox; area: number }[] = [];
      const stack: number[] = [];
      for (let i0 = 0; i0 < n; i0++) {
        if (!mask[i0] || visited[i0]) continue;
        let minX = AW, maxX = 0, minY = AH, maxY = 0, area = 0;
        stack.length = 0;
        stack.push(i0);
        visited[i0] = 1;
        while (stack.length) {
          const i = stack.pop()!;
          const x = i % AW;
          const y = (i / AW) | 0;
          area++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          const neigh = [i - 1, i + 1, i - AW, i + AW];
          for (const q of neigh) {
            if (q < 0 || q >= n || visited[q] || !mask[q]) continue;
            const qx = q % AW;
            if (Math.abs(qx - x) > 1) continue; // row wrap guard
            visited[q] = 1;
            stack.push(q);
          }
        }
        if (area >= MIN_BLOB_AREA) {
          blobs.push({
            bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
            area,
          });
        }
      }

      // classify + match into tracks
      for (const t of this.tracks) t.matched = false;
      for (const b of blobs) {
        const cx = b.bbox.x + b.bbox.w / 2;
        const cy = b.bbox.y + b.bbox.h / 2;
        let best: Track | null = null;
        let bestD = MATCH_DIST;
        for (const t of this.tracks) {
          const tcx = t.bbox.x + t.bbox.w / 2;
          const tcy = t.bbox.y + t.bbox.h / 2;
          const d = Math.hypot(cx - tcx, cy - tcy);
          if (d < bestD) {
            bestD = d;
            best = t;
          }
        }
        const cls = classifyBlob(b.bbox, b.area);
        if (best) {
          best.bbox = b.bbox;
          best.area = b.area;
          // STICKY CLASS: a track keeps its spawn-time classification for its
          // whole lifetime. Per-frame reclassification is brittle — a walking
          // person (aspect 1.6) standing still can pixel-shrink to aspect 1.2
          // and would flip to "vehicle", wrongly ending a person-gated event.
          best.lastSeen = tSec;
          best.matched = true;
        } else {
          this.tracks.push({
            id: this.nextTrackId++,
            bbox: b.bbox,
            cls,
            area: b.area,
            lastSeen: tSec,
            matched: true,
          });
        }
      }

      // expire tracks → schedule background re-absorption ("ghost release")
      const alive: Track[] = [];
      for (const t of this.tracks) {
        if (tSec - t.lastSeen <= TRACK_TTL) {
          alive.push(t);
        } else {
          this.releases.push({ bbox: t.bbox, until: tSec + 1.4 });
        }
      }
      this.tracks = alive.slice(-24);
      this.releases = this.releases.filter((r) => r.until > tSec).slice(-24);

      // pixel flags: 1 = frozen (inside live track bbox), 2 = fast-release
      this.flags.fill(0);
      for (const t of this.tracks) {
        if (tSec - t.lastSeen < ANCHOR_HOLD) paintRect(this.flags, inflate(t.bbox, 2), 1);
      }
      for (const r of this.releases) {
        paintRect(this.flags, r.bbox, 2, true);
      }
    }

    /* -------------------------- background adaptation ------------------------ */
    // frozen pixels never adapt → stationary dwellers stay foreground.
    // released pixels adapt fast → exit ghosts vanish in <1s.
    const flags = this.flags;
    for (let i = 0; i < n; i++) {
      if (flags[i] === 1) continue;
      const a = flags[i] === 2 ? 0.3 : 0.012;
      bg[i] += (cur[i] - bg[i]) * a;
    }
    this.prev = cur;

    /* --------------------------- object zone signals ------------------------- */
    const blobInfos: BlobInfo[] = [];
    for (const t of this.tracks) {
      if (tSec - t.lastSeen < 0.6) {
        blobInfos.push({
          x: t.bbox.x / AW,
          y: t.bbox.y / AH,
          w: t.bbox.w / AW,
          h: t.bbox.h / AH,
          cls: t.cls,
          area: t.area,
        });
      }
    }
    for (const z of zones) {
      if (z.mode !== "object") continue;
      const zr = this.zonePx(z.rect);
      let best = 0;
      for (const t of this.tracks) {
        if (t.cls !== z.targetClass) continue;
        if (tSec - t.lastSeen > 0.6) continue;
        const inter = intersectArea(t.bbox, zr);
        const trackArea = Math.max(1, t.bbox.w * t.bbox.h);
        const cov = inter / trackArea;
        if (cov > best) best = cov;
      }
      const active = best >= z.overlap;
      outZones[z.id] = { active, confidence: active ? Math.min(1, 0.35 + best * 0.65) : best, value: best };
    }

    return dbg
      ? { zones: outZones, blobs: blobInfos, debugMask: dbg, debugW: AW, debugH: AH }
      : { zones: outZones, blobs: blobInfos };
  }
}

function classifyBlob(b: BBox, area: number): ObjectClass {
  const aspect = b.h / Math.max(1, b.w);
  if (aspect >= 1.35) return "person";
  if (area >= 140 || b.w >= 24) return "vehicle";
  return "package";
}

function paintRect(flags: Uint8Array, r: BBox, value: number, onlyLower = false): void {
  const x0 = Math.max(0, Math.round(r.x));
  const y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(AW, Math.round(r.x + r.w));
  const y1 = Math.min(AH, Math.round(r.y + r.h));
  for (let y = y0; y < y1; y++) {
    const row = y * AW;
    for (let x = x0; x < x1; x++) {
      if (!onlyLower || flags[row + x] < value) flags[row + x] = value;
    }
  }
}

function inflate(b: BBox, px: number): BBox {
  return { x: b.x - px, y: b.y - px, w: b.w + px * 2, h: b.h + px * 2 };
}

function intersectArea(a: BBox, b: BBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}
