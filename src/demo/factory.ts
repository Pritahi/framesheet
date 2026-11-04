/**
 * Demo 2 · Factory Packing Station (60s synthesized CCTV).
 *
 *   Zone_A "Packing Bench" (MOTION): three ~6s packing cycles at t≈2/11/20,
 *     then a TANGLED-TAPE ANOMALY holding the bench active 31.4s → 58s (~26.6s
 *     BOTTLENECK). Idle gaps of 3s between cycles prove segments stay separate;
 *     the anomaly's continuous fidget proves cooling-gap merging.
 *   Zone_B "Conveyor" (MOTION): boxes crossing at ~2.3s each; the belt's own
 *     low-amplitude stripe motion must stay under the sensitivity threshold.
 */

import type { SceneSpec } from "../engine/source";
import { LH, LW, applyFlicker, cctvOverlay, flickerAmp, lerp, rr } from "./helpers";

const CYCLES = [2, 11, 20];
const ANOMALY_T = 31;
const BOX_SPAWNS = [4, 9, 15, 21, 27, 35, 41, 47, 53];

/** box position on bench; also returns whether arms are actively packing */
function benchState(t: number): { bx: number; wrapping: boolean; anomaly: boolean } | null {
  for (const c of CYCLES) {
    if (t >= c + 0.4 && t < c + 7.6) {
      let bx = 470;
      if (t < c + 0.9) bx = lerp(706, 470, (t - c - 0.4) / 0.5);
      else if (t >= c + 6.0) bx = lerp(470, 190, (t - c - 6.0) / 1.6);
      return { bx, wrapping: t >= c + 0.9 && t < c + 6.0, anomaly: false };
    }
  }
  if (t >= ANOMALY_T + 0.4 && t < 58) {
    let bx = 470;
    if (t < ANOMALY_T + 0.9) bx = lerp(706, 470, (t - ANOMALY_T - 0.4) / 0.5);
    return { bx, wrapping: true, anomaly: t >= ANOMALY_T + 0.9 };
  }
  if (t >= 58 && t < 59.6) return { bx: lerp(470, 180, (t - 58) / 1.6), wrapping: false, anomaly: false };
  return null;
}

export function renderFactory(ctx: CanvasRenderingContext2D, rawT: number, w: number, h: number): void {
  const t = Math.min(rawT, 59.95);
  ctx.save();
  ctx.scale(w / LW, h / LH);

  /* --------------------------------- floor --------------------------------- */
  const grad = ctx.createLinearGradient(0, 0, 0, LH);
  grad.addColorStop(0, "#141B26");
  grad.addColorStop(1, "#10151F");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, LW, LH);

  // safety grid on floor
  ctx.strokeStyle = "rgba(148,163,184,0.07)";
  ctx.lineWidth = 1.5;
  for (let x = 0; x <= LW; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, LH);
    ctx.stroke();
  }
  for (let y = 0; y <= LH; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(LW, y);
    ctx.stroke();
  }
  // hazard border around work cell
  ctx.save();
  ctx.strokeStyle = "rgba(245,158,11,0.35)";
  ctx.lineWidth = 6;
  ctx.setLineDash([26, 18]);
  ctx.strokeRect(240, 140, 520, 300);
  ctx.restore();

  /* ---------------------------- packing bench (Zone_A) ----------------------- */
  ctx.fillStyle = "#26303E";
  rr(ctx, 280, 180, 420, 200, 8);
  ctx.fill();
  ctx.fillStyle = "#2E3A4C";
  rr(ctx, 280, 180, 420, 18, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(52,211,153,0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(280, 180, 420, 200);
  // tape roll + tools (static)
  ctx.fillStyle = "#0F172A";
  rr(ctx, 620, 210, 60, 44, 8);
  ctx.fill();
  ctx.fillStyle = "#475569";
  ctx.beginPath();
  ctx.arc(650, 232, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#94A3B8";
  ctx.beginPath();
  ctx.arc(650, 232, 6, 0, Math.PI * 2);
  ctx.fill();

  const st = benchState(t);
  const armsBusy = st !== null && (st.wrapping || st.bx > 480);

  /* ------------------------------ worker + arms ------------------------------ */
  // torso silhouette (static)
  ctx.fillStyle = "#1E293B";
  rr(ctx, 400, -40, 200, 150, 40);
  ctx.fill();
  ctx.fillStyle = "#334155";
  ctx.beginPath();
  ctx.arc(500, 30, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#F8FAFC";
  ctx.beginPath();
  ctx.arc(500, 20, 30, Math.PI, Math.PI * 2);
  ctx.fill();

  // arms — deterministic poses: swinging while wrapping, micro-fidget during anomaly
  const armPose = (side: 0 | 1): [number, number] => {
    if (!armsBusy) return side === 0 ? [0.5, 0.9] : [-0.5, 0.9];
    if (st?.anomaly) {
      const j = Math.sin(t * 9 + side * 2.1) * 0.12;
      const reach = 0.55 + Math.sin(t * 2.4 + side) * 0.08;
      return [side === 0 ? 0.42 + j : -0.42 + j, reach];
    }
    const ph = t * 2.6;
    return side === 0
      ? [0.55 + Math.sin(ph) * 0.28, 0.55 + Math.cos(ph * 0.7) * 0.3]
      : [-0.55 + Math.sin(ph + Math.PI) * 0.28, 0.55 + Math.sin(ph * 0.8) * 0.3];
  };

  for (const side of [0, 1] as const) {
    const rootX = side === 0 ? 444 : 556;
    const [ang, reach] = armPose(side);
    const len = 200 + reach * 90;
    const tipX = rootX + Math.sin(ang) * len * 0.55;
    const tipY = 86 + Math.cos(ang * 0.6) * len * 0.45 * (0.7 + reach * 0.3);
    ctx.strokeStyle = "#2563EB";
    ctx.lineWidth = 30;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(rootX, 60);
    ctx.quadraticCurveTo(rootX + ang * 90, 170, tipX, 120 + tipY * 0.35);
    ctx.stroke();
    // glove
    ctx.fillStyle = "#F59E0B";
    ctx.beginPath();
    ctx.arc(tipX, 120 + tipY * 0.35, 15, 0, Math.PI * 2);
    ctx.fill();
  }

  // bench box
  if (st) {
    const jitter = st.anomaly ? Math.sin(t * 11) * 2.2 : 0;
    ctx.fillStyle = "#B7791F";
    rr(ctx, st.bx - 35 + jitter, 300, 70, 54, 4);
    ctx.fill();
    ctx.fillStyle = "#8A5A17";
    ctx.fillRect(st.bx - 35 + jitter, 320, 70, 8);
    if (st.anomaly) {
      // tangled tape flashes crimson — the visible anomaly cue
      const blink = Math.sin(t * Math.PI * 2) > 0;
      ctx.fillStyle = blink ? "#EF4444" : "#7F1D1D";
      ctx.fillRect(st.bx - 20 + jitter, 296, 46, 6);
    } else if (st.wrapping) {
      ctx.fillStyle = "#34D399";
      const u = Math.min(1, (t % 9) / 1);
      ctx.fillRect(st.bx - 20 + jitter, 296, 46 * (0.4 + 0.6 * Math.abs(Math.sin(t * 3))), 6);
      void u;
    }
  }

  /* ------------------------------ conveyor (Zone_B) -------------------------- */
  ctx.fillStyle = "#121922";
  rr(ctx, 0, 424, LW, 84, 0);
  ctx.fill();
  ctx.fillStyle = "#1C2733";
  ctx.fillRect(0, 424, LW, 8);
  ctx.fillRect(0, 500, LW, 8);
  // low-amplitude belt stripes (below sensitivity threshold)
  ctx.fillStyle = "rgba(100,116,139,0.13)";
  const beltOff = (t * 30) % 34;
  for (let sx = -34; sx < LW; sx += 34) ctx.fillRect(sx + beltOff, 434, 12, 64);

  for (const t0 of BOX_SPAWNS) {
    const x = 970 - 150 * (t - t0);
    if (x < -100 || x > 1000) continue;
    ctx.fillStyle = "#F59E0B";
    rr(ctx, x, 428, 88, 48, 5);
    ctx.fill();
    ctx.fillStyle = "#B45309";
    ctx.fillRect(x, 446, 88, 8);
    ctx.fillStyle = "#78350F";
    ctx.font = "700 17px ui-monospace, monospace";
    ctx.fillText("PKG", x + 26, 442);
  }

  /* --------------------------------- overlays -------------------------------- */
  applyFlicker(ctx, flickerAmp(t, [[16.5, 16.9]]));
  cctvOverlay(ctx, t, "CAM 02 · PACKING");
  ctx.restore();
}

export const factoryScene: SceneSpec = {
  id: "factory",
  title: "Factory Packing Station",
  subtitle: "Cyclic packing · tangled-tape anomaly holds bench ~26.6s at 00:31",
  camLabel: "CAM 02 · PACKING",
  duration: 60,
  render: renderFactory,
};
