/**
 * Zone presets for the bundled REAL FOOTAGE scenario (card terminal close-up).
 *
 * Shared by the UI scenario registry and the real-footage e2e test, so the
 * numbers a judge sees on first click are the numbers under test.
 *
 * Tuned from the clip's composition (480×270 source):
 *   Zone_A "Card Terminal" — the tap/hover area over the terminal screen.
 *   Zone_B "Approach Lane" — left edge where the hand enters frame.
 * Quick contactless taps are brief, hence the 300ms start-hold (the
 * "Quick Tap" preset) rather than the 800ms default.
 */

import type { ZoneConfig } from "../engine/types";

export function REAL_FOOTAGE_ZONES(): ZoneConfig[] {
  return [
    {
      id: "rz-a",
      name: "Zone_A",
      label: "Card Terminal",
      color: "#10B981",
      rect: { x: 0.28, y: 0.28, w: 0.5, h: 0.42 },
      mode: "motion",
      targetClass: "person",
      sensitivity: 0.05,
      overlap: 0.45,
      startHoldMs: 300,
      gapMergeMs: 1500,
      enabled: true,
    },
    {
      id: "rz-b",
      name: "Zone_B",
      label: "Approach Lane",
      color: "#38BDF8",
      rect: { x: 0.0, y: 0.18, w: 0.26, h: 0.62 },
      mode: "motion",
      sensitivity: 0.05,
      targetClass: "person",
      overlap: 0.45,
      startHoldMs: 300,
      gapMergeMs: 1500,
      enabled: true,
    },
  ];
}
