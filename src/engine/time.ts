/** Small deterministic time/severity formatting helpers. */

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 74.26 -> "01:14.2" (mm:ss.tenths, video-player style). */
export function fmtClock(tSec: number): string {
  const t = Math.max(0, tSec);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const tenths = Math.floor((t - Math.floor(t)) * 10);
  return `${pad2(m)}:${pad2(s)}.${tenths}`;
}

/** 74.26 -> "74.3s" */
export function fmtDur(tSec: number): string {
  return `${(Math.round(tSec * 10) / 10).toFixed(1)}s`;
}

/** Round to 2 decimals for spreadsheet display. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
