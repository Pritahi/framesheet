/**
 * Procedural scene helpers — everything is a PURE function of time t so the
 * synthesized "CCTV footage" is deterministic and perfectly seekable.
 */

export const LW = 960; // logical width
export const LH = 540; // logical height

export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
export const easeInOut = (u: number): number => u * u * (3 - 2 * u);
export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** deterministic hash noise in [0,1) from integer-ish coords */
export function hash01(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Global light-flicker: returns a brightness bump during scripted windows. */
export function flickerAmp(t: number, windows: [number, number][]): number {
  for (const [a, b] of windows) {
    if (t >= a && t <= b) return 0.05 * Math.sin(((t - a) / (b - a)) * Math.PI);
  }
  return 0;
}

/* ------------------------------- person sprite ------------------------------ */

export interface PersonOpts {
  shirt: string;
  pants?: string;
  skin?: string;
  /** leg swing phase; null = standing */
  walk?: number | null;
  /** 0..1 forward bend (reaching pose) */
  lean?: number;
  /** horizontal scale factor */
  scale?: number;
  carry?: boolean;
}

/** Side-view human silhouette, feet-anchored at (cx, feetY), height h. */
export function person(
  ctx: CanvasRenderingContext2D,
  cx: number,
  feetY: number,
  h: number,
  o: PersonOpts
): void {
  const pants = o.pants ?? "#1E293B";
  const skin = o.skin ?? "#E8B98A";
  const walk = o.walk ?? null;
  const lean = o.lean ?? 0;
  const hipY = feetY - 0.45 * h;
  const shoulderY = feetY - 0.78 * h;
  const legL = 0.45 * h;
  const armL = 0.34 * h;

  // soft shadow
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.beginPath();
  ctx.ellipse(cx, feetY + 2, 0.30 * h, 0.065 * h, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs
  ctx.lineCap = "round";
  const swingA = walk !== null ? Math.sin(walk) * 0.5 : 0.06;
  const swingB = walk !== null ? Math.sin(walk + Math.PI) * 0.5 : -0.06;
  for (const [dx, ang] of [[-0.045 * h, swingA], [0.045 * h, swingB]] as const) {
    const fx = cx + dx + Math.sin(ang) * legL;
    const fy = hipY + Math.cos(ang) * legL;
    ctx.strokeStyle = pants;
    ctx.lineWidth = 0.10 * h;
    ctx.beginPath();
    ctx.moveTo(cx + dx, hipY);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.fillStyle = "#11151C";
    ctx.beginPath();
    ctx.ellipse(fx + 0.02 * h, fy, 0.075 * h, 0.032 * h, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // upper body group (torso + head + arms), leaning about hip
  ctx.save();
  ctx.translate(cx, hipY);
  ctx.rotate(-lean * 0.75);
  ctx.translate(-cx, -hipY);

  // torso
  ctx.fillStyle = o.shirt;
  rr(ctx, cx - 0.13 * h, shoulderY - 0.02 * h, 0.26 * h, hipY - shoulderY + 0.06 * h, 0.09 * h);
  ctx.fill();

  // arms
  const armSwing = walk !== null ? -Math.sin(walk) * 0.42 : 0.12;
  const shX = cx + 0.03 * h;
  const shY = shoulderY + 0.04 * h;
  const elbowX = shX + Math.sin(0.25 + armSwing) * armL * 0.55;
  const elbowY = shY + Math.cos(0.25 + armSwing) * armL * 0.55;
  const handX = elbowX + Math.sin(0.55 + armSwing * 0.6 + lean * 1.5) * armL * 0.5;
  const handY = elbowY + Math.cos(0.35 + lean * 1.6) * armL * 0.5;
  ctx.strokeStyle = o.shirt;
  ctx.lineWidth = 0.085 * h;
  ctx.beginPath();
  ctx.moveTo(shX, shY);
  ctx.lineTo(elbowX, elbowY);
  ctx.stroke();
  ctx.strokeStyle = skin;
  ctx.lineWidth = 0.06 * h;
  ctx.beginPath();
  ctx.moveTo(elbowX, elbowY);
  ctx.lineTo(handX, handY);
  ctx.stroke();
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(handX, handY, 0.045 * h, 0, Math.PI * 2);
  ctx.fill();

  if (o.carry) {
    ctx.fillStyle = "#B7791F";
    rr(ctx, handX - 0.02 * h, handY, 0.16 * h, 0.14 * h, 0.02 * h);
    ctx.fill();
  }

  // head + beanie
  const headR = 0.085 * h;
  const headCy = shoulderY - 0.10 * h;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(cx + lean * 0.04 * h, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.arc(cx + lean * 0.04 * h, headCy - 0.012 * h, headR, Math.PI, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/* ------------------------------ vehicle sprites ----------------------------- */

export type VehicleKind = "truck" | "van" | "forklift";

export function vehicle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  kind: VehicleKind,
  brake = false
): void {
  ctx.save();
  ctx.translate(cx, cy);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  if (kind === "truck") {
    ctx.beginPath();
    ctx.ellipse(0, 40, 102, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    // trailer
    ctx.fillStyle = "#C7D2E0";
    rr(ctx, -96, -38, 148, 66, 5);
    ctx.fill();
    ctx.fillStyle = "#8FA1B8";
    rr(ctx, -92, -30, 140, 8, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(30,41,59,0.5)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(-80 + i * 28, -34);
      ctx.lineTo(-80 + i * 28, 24);
      ctx.stroke();
    }
    // cab
    ctx.fillStyle = "#E06A32";
    rr(ctx, 54, -22, 44, 50, 7);
    ctx.fill();
    ctx.fillStyle = "#BEE3F8";
    rr(ctx, 62, -16, 26, 16, 3);
    ctx.fill();
    // wheels
    for (const wx of [-78, -52, 66, 86]) {
      ctx.fillStyle = "#0B0F17";
      ctx.beginPath();
      ctx.arc(wx, 30, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#334155";
      ctx.beginPath();
      ctx.arc(wx, 30, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "van") {
    ctx.beginPath();
    ctx.ellipse(0, 30, 72, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4FD1C5";
    rr(ctx, -66, -26, 132, 52, 12);
    ctx.fill();
    ctx.fillStyle = "#1A202C";
    rr(ctx, 18, -18, 40, 18, 5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    rr(ctx, -52, -14, 44, 10, 4);
    ctx.fill();
    for (const wx of [-42, 40]) {
      ctx.fillStyle = "#0B0F17";
      ctx.beginPath();
      ctx.arc(wx, 26, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // forklift (compact, classified as "package" by the blob classifier)
    ctx.beginPath();
    ctx.ellipse(0, 20, 40, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FBBF24";
    rr(ctx, -30, -16, 48, 30, 5);
    ctx.fill();
    ctx.fillStyle = "#111827";
    rr(ctx, -24, -30, 28, 16, 3);
    ctx.fill();
    ctx.strokeStyle = "#94A3B8";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(24, -30);
    ctx.lineTo(24, 14);
    ctx.stroke();
    ctx.strokeStyle = "#CBD5E1";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(26, 12);
    ctx.lineTo(52, 12);
    ctx.stroke();
    for (const wx of [-18, 12]) {
      ctx.fillStyle = "#0B0F17";
      ctx.beginPath();
      ctx.arc(wx, 16, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (brake) {
    ctx.fillStyle = "rgba(239,68,68,0.9)";
    ctx.beginPath();
    ctx.arc(-96, 8, 4, 0, Math.PI * 2);
    ctx.arc(-96, -8, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* -------------------------------- CCTV chrome ------------------------------- */

export function cctvOverlay(
  ctx: CanvasRenderingContext2D,
  t: number,
  camLabel: string
): void {
  // grain sparkle (deterministic per 24fps frame index + pixel index)
  const frame = Math.floor(t * 24);
  ctx.fillStyle = "rgba(226,232,240,0.05)";
  for (let i = 0; i < 90; i++) {
    const gx = hash01(frame, i, 1) * LW;
    const gy = hash01(frame, i, 2) * LH;
    ctx.fillRect(gx, gy, 1.6, 1.6);
  }

  // scanlines
  ctx.fillStyle = "rgba(2,6,12,0.16)";
  for (let y = 0; y < LH; y += 4) ctx.fillRect(0, y, LW, 1.4);

  // vignette
  const vg = ctx.createRadialGradient(LW / 2, LH * 0.42, LH * 0.35, LW / 2, LH / 2, LH * 0.95);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, LW, LH);

  // HUD text
  ctx.font = "600 15px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "rgba(167,243,208,0.85)";
  ctx.fillText(camLabel, 22, 32);
  const recOn = t % 1 < 0.62;
  if (recOn) {
    ctx.fillStyle = "#EF4444";
    ctx.beginPath();
    ctx.arc(LW - 132, 26, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(226,232,240,0.85)";
  ctx.fillText("REC", LW - 118, 32);

  const mm = String(Math.floor(t / 60)).padStart(2, "0");
  const ss = String(Math.floor(t % 60)).padStart(2, "0");
  const ds = String(Math.floor((t % 1) * 10));
  ctx.fillStyle = "rgba(167,243,208,0.7)";
  ctx.fillText(`${mm}:${ss}.${ds}`, LW - 90, LH - 20);
  ctx.fillStyle = "rgba(148,163,184,0.6)";
  ctx.fillText("FRAMESHEET SYNTH-FEED", 22, LH - 20);
}

/** Apply global light flicker as an additive white wash. */
export function applyFlicker(ctx: CanvasRenderingContext2D, amp: number): void {
  if (amp <= 0) return;
  ctx.fillStyle = `rgba(235,245,255,${amp.toFixed(4)})`;
  ctx.fillRect(0, 0, LW, LH);
}
