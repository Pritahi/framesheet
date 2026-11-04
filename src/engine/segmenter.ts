/**
 * FrameSheet — GATE 1: the Hysteresis / Debounce event segmenter.
 *
 * A pure, allocation-light state machine that converts a noisy per-sample
 * boolean "activity" signal into clean [start, end] event segments:
 *
 *   IDLE ──active──▶ ARMING ──held ≥ startHold──▶ ACTIVE ──inactive──▶ COOLING
 *    ▲                │                                ▲                   │
 *    └──inactive──────┘                                └──active───────────┘
 *    ◀──────────── gap ≥ gapMerge (emit segment) ───────┘
 *
 * Properties (enforced by fast-check property tests):
 *  P-NOISE   A burst shorter than startHoldMs never emits a segment.
 *  P-ANCHOR  A segment's start is the timestamp of the FIRST active sample
 *            (retroactive anchoring — the hold duration is not lost).
 *  P-MERGE   Two active runs separated by an inactive gap < gapMergeMs merge
 *            into exactly ONE segment.
 *  P-SPLIT   A gap ≥ gapMergeMs terminates the segment (end = last active ts).
 *  P-BOUNDS  end > start, 0 ≤ peak ≤ 1, segments are emitted in order.
 */

export interface SegmenterParams {
  startHoldMs: number;
  gapMergeMs: number;
}

export type SegmenterPhase = "IDLE" | "ARMING" | "ACTIVE" | "COOLING";

export interface SegmenterState {
  phase: SegmenterPhase;
  /** timestamp of first active sample of the candidate run */
  armStart: number;
  /** committed segment start (== armStart once ACTIVE) */
  segStart: number;
  /** timestamp of the most recent active sample */
  lastActive: number;
  /** max confidence observed within the segment */
  peak: number;
}

export function initialSegmenterState(): SegmenterState {
  return { phase: "IDLE", armStart: 0, segStart: 0, lastActive: 0, peak: 0 };
}

export interface CompletedSegment {
  start: number;
  end: number;
  duration: number;
  peak: number;
}

export interface SegmenterOutput {
  state: SegmenterState;
  /** fired exactly once when a candidate run survives the start-hold */
  started?: { start: number };
  /** fired exactly once when a cooling gap exceeds gapMergeMs */
  completed?: CompletedSegment;
}

export function stepSegmenter(
  prev: SegmenterState,
  tSec: number,
  active: boolean,
  confidence: number,
  params: SegmenterParams
): SegmenterOutput {
  const s: SegmenterState = { ...prev };
  const conf = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  const holdSec = Math.max(0, params.startHoldMs) / 1000;
  const gapSec = Math.max(0, params.gapMergeMs) / 1000;
  let started: SegmenterOutput["started"];
  let completed: SegmenterOutput["completed"];

  switch (s.phase) {
    case "IDLE": {
      if (active) {
        s.phase = "ARMING";
        s.armStart = tSec;
        s.segStart = tSec;
        s.lastActive = tSec;
        s.peak = conf;
      }
      break;
    }
    case "ARMING": {
      if (!active) {
        // noise rejected — never becomes a segment
        s.phase = "IDLE";
        s.peak = 0;
      } else {
        s.lastActive = tSec;
        s.peak = Math.max(s.peak, conf);
        if (tSec - s.armStart >= holdSec) {
          s.phase = "ACTIVE";
          s.segStart = s.armStart; // P-ANCHOR: keep first-rise timestamp
          started = { start: s.segStart };
        }
      }
      break;
    }
    case "ACTIVE": {
      if (active) {
        s.lastActive = tSec;
        s.peak = Math.max(s.peak, conf);
      } else {
        s.phase = "COOLING";
      }
      break;
    }
    case "COOLING": {
      if (active) {
        // P-MERGE: brief drop-out absorbed into the same segment
        s.phase = "ACTIVE";
        s.lastActive = tSec;
        s.peak = Math.max(s.peak, conf);
      } else if (tSec - s.lastActive >= gapSec) {
        // P-SPLIT: segment ends at the LAST ACTIVE sample, not at now
        completed = {
          start: s.segStart,
          end: s.lastActive,
          duration: s.lastActive - s.segStart,
          peak: s.peak,
        };
        s.phase = "IDLE";
        s.peak = 0;
      }
      break;
    }
  }

  return { state: s, started, completed };
}

/**
 * Flush an open segment (video paused / ended / source switched).
 * Emits a completed segment iff the machine is ACTIVE or COOLING.
 */
export function flushSegmenter(prev: SegmenterState): {
  state: SegmenterState;
  completed?: CompletedSegment;
} {
  if (prev.phase === "ACTIVE" || prev.phase === "COOLING") {
    if (prev.lastActive > prev.segStart) {
      return {
        state: { ...initialSegmenterState() },
        completed: {
          start: prev.segStart,
          end: prev.lastActive,
          duration: prev.lastActive - prev.segStart,
          peak: prev.peak,
        },
      };
    }
  }
  return { state: { ...initialSegmenterState() } };
}
