/**
 * FrameSheet — core domain types.
 * Everything here is plain data so the engines stay pure and property-testable.
 */

export type ZoneMode = "motion" | "object";
export type ObjectClass = "person" | "vehicle" | "package";

/** Normalized rectangle (0..1 relative to video frame). */
export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ZoneConfig {
  id: string;
  /** Short machine name used by formulas, e.g. "Zone_A". */
  name: string;
  /** Human label, e.g. "Checkout Counter". */
  label: string;
  color: string;
  rect: ZoneRect;
  mode: ZoneMode;
  /** Target blob class for object mode. */
  targetClass: ObjectClass;
  /** Motion mode: normalized frame-diff threshold 0..1. */
  sensitivity: number;
  /** Object mode: fraction of the tracked blob that must be inside the zone. */
  overlap: number;
  /** Hysteresis: activity must persist this long before an event starts. */
  startHoldMs: number;
  /** Debounce: inactivity gaps shorter than this are merged into the same event. */
  gapMergeMs: number;
  enabled: boolean;
}

export type EventMode = "MOTION" | "OBJECT" | "MANUAL";
export type EventStatus = "NORMAL" | "SLOW" | "BOTTLENECK";
export type VerifyState = "AUTO" | "VERIFIED" | "EDITED" | "DISMISSED";

export interface FrameEvent {
  id: string;
  num: number;
  zoneId: string;
  zoneName: string;
  zoneLabel: string;
  color: string;
  mode: EventMode;
  /** seconds, video timeline */
  start: number;
  /** seconds, video timeline */
  end: number;
  /** seconds */
  duration: number;
  /** 0..1 peak detector confidence */
  peak: number;
  verified: VerifyState;
}

export function eventStatus(ev: FrameEvent, slowAt: number, bottleneckAt: number): EventStatus {
  if (ev.duration >= bottleneckAt) return "BOTTLENECK";
  if (ev.duration >= slowAt) return "SLOW";
  return "NORMAL";
}

export const ZONE_COLORS = ["#10B981", "#38BDF8", "#F59E0B", "#A78BFA", "#F472B6", "#34D399"];

export const DEFAULT_ZONE_PARAMS = {
  startHoldMs: 800,
  gapMergeMs: 1500,
  sensitivity: 0.08,
  overlap: 0.45,
} as const;
