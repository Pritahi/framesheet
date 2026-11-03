/**
 * Scenario registry — each demo ships with tuned Zone presets so a judge gets
 * meaningful events within the first seconds of pressing play.
 */

import type { SceneSpec } from "../engine/source";
import { DEFAULT_ZONE_PARAMS, type ZoneConfig } from "../engine/types";
import { retailScene } from "./retail";
import { factoryScene } from "./factory";
import { dockScene } from "./dock";

export type ScenarioId = "retail" | "factory" | "dock";

export interface Scenario {
  id: ScenarioId;
  scene: SceneSpec;
  makeZones: () => ZoneConfig[];
}

/**
 * The 4th feed is NOT procedural: it is a real 10.5s CCTV-style clip of a
 * contactless payment at a card terminal, trimmed + compressed to ~38KB and
 * bundled into the app (Pexels #5101679, Gustavo Fring — Pexels License).
 * Pre-tuned with the Quick Tap preset so judges see real-camera detection and
 * Click-to-Proof in one click, without hunting for a video file.
 */
export const REAL_FOOTAGE = {
  id: "real" as const,
  title: "REAL FOOTAGE · Card Terminal",
  subtitle: "Genuine camera clip · contactless payment dwell · pre-tuned Quick Tap",
  camLabel: "CAM 03 · CARD TERMINAL",
  credit: "Pexels #5101679 · Gustavo Fring",
};

let seq = 0;
const zid = () => `z${++seq}`;

function zone(partial: Partial<ZoneConfig> & { name: string; label: string; rect: ZoneConfig["rect"] }): ZoneConfig {
  return {
    id: zid(),
    color: "#10B981",
    mode: "motion",
    targetClass: "person",
    sensitivity: DEFAULT_ZONE_PARAMS.sensitivity,
    overlap: DEFAULT_ZONE_PARAMS.overlap,
    startHoldMs: DEFAULT_ZONE_PARAMS.startHoldMs,
    gapMergeMs: DEFAULT_ZONE_PARAMS.gapMergeMs,
    enabled: true,
    ...partial,
  };
}

export const SCENARIOS: Scenario[] = [
  {
    id: "retail",
    scene: retailScene,
    makeZones: () => [
      zone({
        name: "Zone_A",
        label: "Checkout Counter",
        color: "#10B981",
        rect: { x: 0.55, y: 0.359, w: 0.33, h: 0.461 },
        mode: "object",
        targetClass: "person",
        overlap: 0.45,
      }),
      zone({
        name: "Zone_B",
        label: "Entry Lane",
        color: "#38BDF8",
        rect: { x: 0.05, y: 0.6, w: 0.25, h: 0.35 },
        mode: "motion",
        sensitivity: 0.045,
      }),
    ],
  },
  {
    id: "factory",
    scene: factoryScene,
    makeZones: () => [
      zone({
        name: "Zone_A",
        label: "Packing Bench",
        color: "#10B981",
        rect: { x: 0.2917, y: 0.3704, w: 0.3542, h: 0.3704 },
        mode: "motion",
        sensitivity: 0.06,
      }),
      zone({
        name: "Zone_B",
        label: "Conveyor",
        color: "#38BDF8",
        rect: { x: 0.0417, y: 0.7852, w: 0.2708, h: 0.1481 },
        mode: "motion",
        sensitivity: 0.045,
      }),
    ],
  },
  {
    id: "dock",
    scene: dockScene,
    makeZones: () => [
      zone({
        name: "Zone_A",
        label: "Bay 1",
        color: "#10B981",
        rect: { x: 0.125, y: 0.2593, w: 0.3125, h: 0.3519 },
        mode: "object",
        targetClass: "vehicle",
        overlap: 0.4,
      }),
      zone({
        name: "Zone_B",
        label: "Bay 2",
        color: "#38BDF8",
        rect: { x: 0.5, y: 0.2593, w: 0.3125, h: 0.3519 },
        mode: "object",
        targetClass: "vehicle",
        overlap: 0.4,
      }),
    ],
  },
];

/** Generic zones for user uploads. */
export function uploadZones(): ZoneConfig[] {
  return [
    zone({
      name: "Zone_A",
      label: "Primary ROI",
      color: "#10B981",
      rect: { x: 0.55, y: 0.3, w: 0.35, h: 0.45 },
      mode: "motion",
      sensitivity: 0.08,
    }),
    zone({
      name: "Zone_B",
      label: "Secondary ROI",
      color: "#38BDF8",
      rect: { x: 0.1, y: 0.3, w: 0.3, h: 0.45 },
      mode: "motion",
      sensitivity: 0.08,
    }),
  ];
}

export { REAL_FOOTAGE_ZONES } from "./realZones";

export function getScenario(id: ScenarioId): Scenario {
  const s = SCENARIOS.find((sc) => sc.id === id);
  if (!s) throw new Error(`Unknown scenario ${id}`);
  return s;
}
