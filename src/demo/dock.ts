/**
 * Demo 3 · Loading Dock / Traffic Bay (60s synthesized CCTV).
 *
 *   Zone_A "Bay 1" (OBJECT/vehicle): truck dwell ≈10s, then a long-haul truck
 *     parked from ≈26s until end-of-feed (~34s BOTTLENECK, flushed at 60s).
 *   Zone_B "Bay 2" (OBJECT/vehicle): one van ≈7s. A bright forklift crosses
 *     Bay 2 at t≈47 but is classified "package" → ignored by the vehicle-mode
 *     zone (a live demo of class filtering).
 */

import type { SceneSpec } from "../engine/source";
import type { VehicleKind } from "./helpers";
import { LH, LW, applyFlicker, cctvOverlay, flickerAmp, lerp, rr, vehicle } from "./helpers";

interface Visit {
  t0: number;
  bayCx: number;
  leave: number;
  kind: VehicleKind;
}

const ROAD_Y = 452;
const PARK_Y = 250;
const BAY1_CX = 270;
const BAY2_CX = 630;

const VISITS: Visit[] = [
  { t0: 2, bayCx: BAY1_CX, leave: 14, kind: "truck" },
  { t0: 13, bayCx: BAY2_CX, leave: 21.8, kind: "van" },
  { t0: 23, bayCx: BAY1_CX, leave: 64, kind: "truck" },
];

function vehiclePose(v: Visit, t: number): { x: number; y: number; brake: boolean } | null {
  const tParkStart = v.t0 + 2.6;
  const tParked = v.t0 + 4.2;
  if (t < v.t0) return null;
  if (t < tParkStart) {
    const u = (t - v.t0) / 2.6;
    return { x: lerp(-260, v.bayCx, u), y: ROAD_Y, brake: false };
  }
  if (t < tParked) {
    const u = (t - tParkStart) / 1.6;
    return { x: v.bayCx, y: lerp(ROAD_Y, PARK_Y, u * u * (3 - 2 * u)), brake: true };
  }
  if (t <= v.leave) {
    return { x: v.bayCx + Math.sin(t * 0.6) * 1.5, y: PARK_Y, brake: false };
  }
  if (t <= v.leave + 1.6) {
    const u = (t - v.leave) / 1.6;
    return { x: v.bayCx, y: lerp(PARK_Y, ROAD_Y, u), brake: true };
  }
  if (t <= v.leave + 4.6) {
    const u = (t - v.leave - 1.6) / 3.0;
    return { x: lerp(v.bayCx, 1240, u), y: ROAD_Y, brake: false };
  }
  return null;
}

export function renderDock(ctx: CanvasRenderingContext2D, rawT: number, w: number, h: number): void {
  const t = Math.min(rawT, 59.95);
  ctx.save();
  ctx.scale(w / LW, h / LH);

  /* ---------------------------------- yard ----------------------------------- */
  const grad = ctx.createLinearGradient(0, 0, 0, LH);
  grad.addColorStop(0, "#151B24");
  grad.addColorStop(1, "#101620");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, LW, LH);

  // asphalt expansion joints
  ctx.strokeStyle = "rgba(148,163,184,0.08)";
  ctx.lineWidth = 2;
  for (let x = 60; x < LW; x += 120) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, LH);
    ctx.stroke();
  }

  // warehouse wall + dock doors (top)
  ctx.fillStyle = "#0F1620";
  ctx.fillRect(0, 0, LW, 96);
  for (let i = 0; i < 4; i++) {
    const dx = 90 + i * 230;
    ctx.fillStyle = "#1B2534";
    rr(ctx, dx, 14, 170, 82, 4);
    ctx.fill();
    ctx.strokeStyle = "#26344A";
    ctx.stroke();
    ctx.fillStyle = "rgba(148,163,184,0.25)";
    for (let s = 0; s < 5; s++) ctx.fillRect(dx + 8, 24 + s * 15, 154, 3);
  }

  // painted bays (Zone_A = bay 1, Zone_B = bay 2)
  for (const [bx, label] of [[120, "BAY 1"], [480, "BAY 2"]] as const) {
    ctx.strokeStyle = "rgba(253,224,71,0.4)";
    ctx.lineWidth = 5;
    ctx.setLineDash([30, 20]);
    ctx.strokeRect(bx, 140, 300, 190);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(253,224,71,0.30)";
    ctx.font = "700 30px ui-monospace, monospace";
    ctx.fillText(label, bx + 108, 174);
  }

  // road band + static lane dashes
  ctx.fillStyle = "#131922";
  ctx.fillRect(0, 380, LW, 130);
  ctx.fillStyle = "rgba(203,213,225,0.28)";
  for (let x = 20; x < LW; x += 90) ctx.fillRect(x, 442, 46, 6);
  ctx.fillStyle = "rgba(245,158,11,0.25)";
  ctx.fillRect(0, 376, LW, 4);

  // static container stack (right side, out of all zones)
  ctx.fillStyle = "#7C2D12";
  rr(ctx, 850, 250, 96, 60, 4);
  ctx.fill();
  ctx.fillStyle = "#1E3A5F";
  rr(ctx, 858, 200, 88, 50, 4);
  ctx.fill();

  /* --------------------------------- vehicles --------------------------------- */
  // forklift dash through Bay 2 (t≈47 → 50.8) — classified "package", ignored
  if (t >= 47 && t <= 50.8) {
    const x = -80 + 345 * (t - 47);
    vehicle(ctx, x, 235, "forklift");
  }

  for (const v of VISITS) {
    const p = vehiclePose(v, t);
    if (!p) continue;
    vehicle(ctx, p.x, p.y, v.kind, p.brake);
  }

  /* --------------------------------- overlays --------------------------------- */
  applyFlicker(ctx, flickerAmp(t, [[11.5, 11.9]]));
  cctvOverlay(ctx, t, "CAM 04 · LOADING DOCK");
  ctx.restore();
}

export const dockScene: SceneSpec = {
  id: "dock",
  title: "Loading Dock / Traffic Bay",
  subtitle: "Vehicle dwell tracking · long-haul truck parked from 00:26 to end",
  camLabel: "CAM 04 · LOADING DOCK",
  duration: 60,
  render: renderDock,
};
