/**
 * Demo 1 · Retail Checkout Counter (72s synthesized CCTV).
 *
 * Scripted ground truth (what the engine must rediscover from pixels alone):
 *   Zone_A "Checkout Counter" (OBJECT/person):
 *     #1 ≈ 3.1s → 10.6s  (7.5s, normal wait)
 *     #2 ≈ 13.6s → 27.1s (13.5s, normal wait)
 *     #3 ≈ 31.0s → 69.2s (~38s BOTTLENECK; customer steps out of the zone for
 *                           1.0s at t≈45 which the gap-merge must absorb)
 *   Zone_B "Entry Lane" (MOTION): three fast pass-bys plus customers walking
 *     out through the lane (~1.2s each). A 0.2s cart dash and a 0.4s light
 *     flicker must be rejected by the start-hold gate.
 */

import type { SceneSpec } from "../engine/source";
import { LH, LW, applyFlicker, cctvOverlay, flickerAmp, hash01, lerp, person, rr } from "./helpers";

interface Customer {
  tIn: number;
  tStand: number;
  dwell: number;
  shirt: string;
  carry?: boolean;
  /** excursion window [t, duration] — bottleneck customer steps out of zone */
  excursion?: [number, number];
}

const SPAWN_X = 1030;
const STAND_X = 692;
const EXIT_X = -170;
const FEET_Y = 368;
const EXIT_DUR = 3.4;

const CUSTOMERS: Customer[] = [
  { tIn: 2.0, tStand: 4.0, dwell: 5.5, shirt: "#2DD4BF" },
  { tIn: 12.5, tStand: 14.0, dwell: 12, shirt: "#FB923C", carry: true },
  { tIn: 30, tStand: 31.6, dwell: 36.5, shirt: "#818CF8", excursion: [45.0, 1.0] },
];

/** passers crossing Zone_B lane (t0 = spawn time) */
const PASSERS = [
  { t0: 6.3, shirt: "#94A3B8" },
  { t0: 22.0, shirt: "#38BDF8" },
  { t0: 47.5, shirt: "#F472B6" },
];

const PANTS = "#3B475E"; // visible against the floor in the foreground mask

function customerX(c: Customer, t: number): { x: number; moving: boolean; lean: number } | null {
  const tOut = c.tStand + c.dwell;
  if (t < c.tIn || t > tOut + EXIT_DUR) return null;
  if (t < c.tStand) {
    const u = (t - c.tIn) / (c.tStand - c.tIn);
    return { x: lerp(SPAWN_X, STAND_X, u), moving: true, lean: 0 };
  }
  if (t <= tOut) {
    let x = STAND_X + Math.sin(t * 0.9) * 2.5;
    let lean = 0.08;
    if (c.excursion) {
      const [ex, dur] = c.excursion;
      if (t >= ex && t <= ex + dur) {
        const u = (t - ex) / dur;
        x += Math.sin(u * Math.PI) * 195; // step far right, briefly out of Zone_A
        lean = 0.55 * Math.sin(u * Math.PI);
      }
    }
    return { x, moving: false, lean };
  }
  const u = (t - tOut) / EXIT_DUR;
  return { x: lerp(STAND_X, EXIT_X, u), moving: true, lean: 0 };
}

export function renderRetail(ctx: CanvasRenderingContext2D, rawT: number, w: number, h: number): void {
  const t = Math.min(rawT, 71.95);
  ctx.save();
  ctx.scale(w / LW, h / LH);

  /* ------------------------------ static scene ------------------------------ */
  const wall = ctx.createLinearGradient(0, 0, 0, LH);
  wall.addColorStop(0, "#151D2B");
  wall.addColorStop(0.42, "#1B2536");
  wall.addColorStop(0.421, "#232B33");
  wall.addColorStop(1, "#1A212B");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, LW, LH);

  // floor perspective grid
  ctx.strokeStyle = "rgba(148,163,184,0.10)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 12; i++) {
    const x = (i / 12) * LW;
    ctx.beginPath();
    ctx.moveTo(lerp(LW / 2, x, 1.6) - LW * 0.3, LH);
    ctx.lineTo(lerp(LW / 2, x, 0.12), 226);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const y = 226 + Math.pow(i / 5, 1.6) * (LH - 226);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(LW, y);
    ctx.stroke();
  }

  // menu boards (static)
  for (let i = 0; i < 3; i++) {
    const bx = 140 + i * 210;
    ctx.fillStyle = "#0F172A";
    rr(ctx, bx, 52, 170, 92, 8);
    ctx.fill();
    ctx.strokeStyle = "#263449";
    ctx.stroke();
    ctx.fillStyle = i === 1 ? "rgba(245,158,11,0.55)" : "rgba(45,212,191,0.4)";
    for (let rI = 0; rI < 4; rI++) ctx.fillRect(bx + 16, 68 + rI * 18, 138 - (rI % 2) * 40, 6);
  }

  // hanging promo sign — gentle pendulum swing near (320,190) [outside zones]
  ctx.save();
  ctx.translate(320, 108);
  ctx.rotate(Math.sin(t * 0.9) * 0.08);
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 46);
  ctx.stroke();
  ctx.fillStyle = "#7C2D12";
  rr(ctx, -64, 46, 128, 54, 8);
  ctx.fill();
  ctx.fillStyle = "#FDE68A";
  ctx.font = "700 22px ui-monospace, monospace";
  ctx.fillText("SALE -20%", -56, 80);
  ctx.restore();

  /* ------------------------------ dynamic cast ------------------------------ */
  // passers in the entry lane (behind counter, full body, bigger scale)
  for (const p of PASSERS) {
    if (t < p.t0 || t > p.t0 + 4.3) continue;
    const x = 478 - 150 * (t - p.t0);
    person(ctx, x, 470, 198, { shirt: p.shirt, pants: PANTS, walk: t * 5.4, skin: "#D9A878" });
  }

  // checkout customers
  for (const c of CUSTOMERS) {
    const p = customerX(c, t);
    if (!p) continue;
    person(ctx, p.x, FEET_Y, 150, {
      shirt: c.shirt,
      pants: PANTS,
      walk: p.moving ? t * 7 : null,
      lean: p.lean,
      carry: c.carry,
      skin: "#E8B98A",
    });
  }

  // cart dash — sub-second noise blip across Zone_B (must be rejected)
  if (t >= 26.5 && t <= 27.0) {
    const x = 560 - 1150 * (t - 26.5);
    ctx.fillStyle = "#A5B4C4";
    rr(ctx, x - 27, 402, 54, 26, 5);
    ctx.fill();
    ctx.strokeStyle = "#64748B";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 27, 406);
    ctx.lineTo(x + 40, 392);
    ctx.stroke();
    ctx.fillStyle = "#0B0F17";
    ctx.beginPath();
    ctx.arc(x - 16, 432, 6, 0, Math.PI * 2);
    ctx.arc(x + 16, 432, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ------------------------------ static counter ---------------------------- */
  // cashier (STATIC from t=0 → absorbed into background model, never detected)
  person(ctx, 300, 372, 142, { shirt: "#334155", walk: null, lean: 0.05, skin: "#C99673" });

  // counter desk (occludes cashier's legs)
  ctx.fillStyle = "#243040";
  rr(ctx, 120, 300, 400, 82, 6);
  ctx.fill();
  ctx.fillStyle = "#2E3D52";
  rr(ctx, 112, 290, 416, 16, 6);
  ctx.fill();
  // conveyor stripes (low amplitude, outside every zone)
  ctx.save();
  ctx.beginPath();
  ctx.rect(128, 312, 260, 58);
  ctx.clip();
  ctx.fillStyle = "#161D27";
  ctx.fillRect(128, 312, 260, 58);
  ctx.fillStyle = "rgba(100,116,139,0.22)";
  const off = (t * 36) % 26;
  for (let sx = 128 - 26; sx < 388; sx += 26) ctx.fillRect(sx + off, 312, 10, 58);
  ctx.restore();
  // register
  ctx.fillStyle = "#0F172A";
  rr(ctx, 402, 240, 62, 52, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(52,211,153,0.7)";
  ctx.fillRect(410, 248, 46, 22);
  // bag stack
  ctx.fillStyle = "#B7791F";
  rr(ctx, 150, 258, 40, 34, 4);
  ctx.fill();
  ctx.fillStyle = "#92600F";
  rr(ctx, 196, 266, 34, 26, 4);
  ctx.fill();

  // corner client branding glint (subtle deterministic shimmer on aisle light)
  const glint = hash01(Math.floor(t * 3), 7, 7) * 0.05;
  ctx.fillStyle = `rgba(52,211,153,${glint})`;
  ctx.fillRect(880, 60, 6, 120);

  /* --------------------------------- overlays -------------------------------- */
  applyFlicker(ctx, flickerAmp(t, [[33.1, 33.5]]));
  cctvOverlay(ctx, t, "CAM 01 · CHECKOUT");
  ctx.restore();
}

export const retailScene: SceneSpec = {
  id: "retail",
  title: "Retail Checkout Counter",
  subtitle: "Customer dwell times · one 38s bottleneck at ~00:31",
  camLabel: "CAM 01 · CHECKOUT",
  duration: 72,
  render: renderRetail,
};
