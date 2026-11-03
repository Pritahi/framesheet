/** CSV / TSV export for the event log (Excel & Google Sheets friendly). */

import type { FrameEvent } from "./types";
import { eventStatus } from "./types";
import { fmtClock } from "./time";

export interface ExportOptions {
  slowAt: number;
  bottleneckAt: number;
}

const HEADERS = [
  "Event",
  "Zone",
  "Label",
  "Mode",
  "Start (mm:ss)",
  "End (mm:ss)",
  "Start (s)",
  "End (s)",
  "Duration (s)",
  "Peak Confidence",
  "Status",
  "Verification",
];

function rows(events: FrameEvent[], opts: ExportOptions): (string | number)[][] {
  return events
    .filter((e) => e.verified !== "DISMISSED")
    .map((e) => [
      e.num,
      e.zoneName,
      e.zoneLabel,
      e.mode,
      fmtClock(e.start),
      fmtClock(e.end),
      e.start.toFixed(2),
      e.end.toFixed(2),
      e.duration.toFixed(2),
      e.peak.toFixed(2),
      eventStatus(e, opts.slowAt, opts.bottleneckAt),
      e.verified,
    ]);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(events: FrameEvent[], opts: ExportOptions): string {
  const lines = [HEADERS.map(csvCell).join(",")];
  for (const r of rows(events, opts)) lines.push(r.map(csvCell).join(","));
  return lines.join("\n");
}

export function toTSV(events: FrameEvent[], opts: ExportOptions): string {
  const lines = [HEADERS.join("\t")];
  for (const r of rows(events, opts)) lines.push(r.join("\t"));
  return lines.join("\n");
}

export function downloadCSV(events: FrameEvent[], opts: ExportOptions, filename = "framesheet-events.csv"): void {
  const blob = new Blob([toCSV(events, opts)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
