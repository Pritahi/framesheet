/**
 * Property-based verification of the hysteresis segmenter (Gate 1).
 *
 * Each property maps 1:1 to an invariant in
 * .kiro/specs/framesheet-engine/requirements.md §Acceptance Invariants.
 * Run: npx vitest run
 */

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  flushSegmenter,
  initialSegmenterState,
  stepSegmenter,
  type CompletedSegment,
  type SegmenterState,
} from "../segmenter";

interface Run {
  completed: CompletedSegment[];
  started: number;
  state: SegmenterState;
}

function runStream(
  samples: [t: number, active: boolean, conf?: number][],
  startHoldMs: number,
  gapMergeMs: number
): Run {
  let state = initialSegmenterState();
  const completed: CompletedSegment[] = [];
  let started = 0;
  for (const [t, active, conf] of samples) {
    const out = stepSegmenter(state, t, active, conf ?? 0.8, { startHoldMs, gapMergeMs });
    state = out.state;
    if (out.started) started++;
    if (out.completed) completed.push(out.completed);
  }
  return { completed, started, state };
}

/** Build a stream: inactive until t0, active burst of `lenA`ms, gap `gapMs`, then a second burst. */
function burstPair(
  t0: number,
  lenA: number,
  gapMs: number,
  lenB: number
): [number, boolean][] {
  const dt = 100;
  const out: [number, boolean][] = [];
  for (let t = 0; t < t0 * 1000; t += dt) out.push([t / 1000, false]);
  const endA = t0 * 1000 + lenA;
  for (let t = t0 * 1000; t <= endA; t += dt) out.push([t / 1000, true]);
  const endGap = endA + gapMs;
  for (let t = endA + dt; t < endGap; t += dt) out.push([t / 1000, false]);
  const endB = endGap + lenB;
  for (let t = endGap; t <= endB; t += dt) out.push([t / 1000, true]);
  for (let t = endB + dt; t <= endB + 6000; t += dt) out.push([t / 1000, false]);
  return out;
}

const holdArb = fc.integer({ min: 200, max: 2000 });
const gapMergeArb = fc.integer({ min: 400, max: 2500 });

describe("segmenter · P-NOISE", () => {
  it("bursts shorter than startHoldMs never emit a segment", () => {
    fc.assert(
      fc.property(holdArb, gapMergeArb, (hold, gap) => {
        const burstLen = Math.floor(hold * 0.6); // strictly < hold
        const samples: [number, boolean][] = [];
        const dt = 100;
        for (let t = 0; t < 1000; t += dt) samples.push([t / 1000, false]);
        // several short bursts, each must die in ARMING
        for (let b = 0; b < 3; b++) {
          const t0 = 1.2 + b * 3;
          for (let t = 0; t <= burstLen; t += dt) samples.push([t0 + t / 1000, true]);
          for (let t = burstLen + dt; t < 2600; t += dt) samples.push([t0 + t / 1000, false]);
        }
        const r = runStream(samples, hold, gap);
        expect(r.started).toBe(0);
        expect(r.completed).toHaveLength(0);
      }),
      { numRuns: 150 }
    );
  });
});

describe("segmenter · P-ANCHOR", () => {
  it("confirmed segments anchor start to the first active sample", () => {
    fc.assert(
      fc.property(holdArb, gapMergeArb, (hold, gap) => {
        const t0 = 2;
        const len = hold + 700; // comfortably above hold
        const samples = burstPair(t0, len, gap + 1000, 300); // second burst short, long split gap
        const r = runStream(samples, hold, gap);
        expect(r.completed.length).toBeGreaterThanOrEqual(1);
        expect(r.completed[0].start).toBeCloseTo(t0, 5);
      }),
      { numRuns: 150 }
    );
  });
});

describe("segmenter · P-MERGE", () => {
  it("inactive gaps < gapMergeMs never split a continuous activity", () => {
    fc.assert(
      fc.property(holdArb, gapMergeArb, (hold, gap) => {
        const lenA = hold + 500;
        const mergeGap = Math.floor(gap * 0.6); // strictly < gapMerge
        const lenB = hold + 400;
        const samples = burstPair(2, lenA, mergeGap, lenB);
        const r = runStream(samples, hold, gap);
        expect(r.started).toBe(1);
        expect(r.completed).toHaveLength(1);
        const seg = r.completed[0];
        expect(seg.start).toBeCloseTo(2, 5);
        // end == last active sample of burst B
        const expectedEnd = 2 + (lenA + mergeGap + lenB) / 1000;
        expect(Math.abs(seg.end - expectedEnd)).toBeLessThanOrEqual(0.101);
      }),
      { numRuns: 150 }
    );
  });
});

describe("segmenter · P-SPLIT", () => {
  it("inactive gaps ≥ gapMergeMs split into two ordered segments; end == last active sample", () => {
    fc.assert(
      fc.property(holdArb, gapMergeArb, (hold, gap) => {
        const lenA = hold + 500;
        const splitGap = gap + 600; // comfortably ≥ gapMerge
        const lenB = hold + 400;
        const samples = burstPair(2, lenA, splitGap, lenB);
        const r = runStream(samples, hold, gap);
        expect(r.started).toBe(2);
        expect(r.completed).toHaveLength(2);
        const [s1, s2] = r.completed;
        // 100ms sample grid → allow one sampling quantum of tolerance
        expect(Math.abs(s1.end - (2 + lenA / 1000))).toBeLessThanOrEqual(0.101);
        expect(Math.abs(s2.start - (2 + (lenA + splitGap) / 1000))).toBeLessThanOrEqual(0.101);
        expect(s2.start).toBeGreaterThan(s1.end);
      }),
      { numRuns: 150 }
    );
  });
});

describe("segmenter · P-BOUNDS", () => {
  it("random streams always emit sane, ordered, non-overlapping segments", () => {
    const sampleArb = fc.record({
      dt: fc.integer({ min: 80, max: 260 }),
      active: fc.boolean(),
      conf: fc.double({ min: 0, max: 1, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(sampleArb, { minLength: 5, maxLength: 120 }),
        holdArb,
        gapMergeArb,
        (specs, hold, gap) => {
          let t = 0;
          const samples: [number, boolean, number][] = specs.map((s) => {
            t += s.dt;
            return [t / 1000, s.active, s.conf];
          });
          const r = runStream(samples, hold, gap);
          let prevEnd = -Infinity;
          for (const seg of r.completed) {
            expect(seg.end).toBeGreaterThan(seg.start);
            expect(seg.peak).toBeGreaterThanOrEqual(0);
            expect(seg.peak).toBeLessThanOrEqual(1);
            expect(seg.start).toBeGreaterThan(prevEnd);
            prevEnd = seg.end;
          }
          // peak is the max conf across the segment
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("segmenter · P-FLUSH", () => {
  it("open segments flush exactly once with end == last active sample", () => {
    fc.assert(
      fc.property(holdArb, gapMergeArb, (hold, gap) => {
        const len = hold + 600;
        const samples: [number, boolean][] = [];
        for (let t = 0; t <= 1000; t += 100) samples.push([t / 1000, false]);
        for (let t = 1200; t <= 1200 + len + 1200; t += 100) samples.push([t / 1000, true]);
        const r = runStream(samples, hold, gap);
        const f1 = flushSegmenter(r.state);
        expect(f1.completed).toBeDefined();
        expect(f1.completed!.start).toBeCloseTo(1.2, 5);
        // 100ms sample grid → allow one sampling quantum of tolerance
        expect(Math.abs(f1.completed!.end - (1200 + len + 1200) / 1000)).toBeLessThanOrEqual(0.101);
        // flushing twice emits nothing
        const f2 = flushSegmenter(f1.state);
        expect(f2.completed).toBeUndefined();
      }),
      { numRuns: 150 }
    );
  });
});
