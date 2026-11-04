/**
 * FrameSheet — frame source abstraction.
 *
 * Two interchangeable sources power every downstream system (display canvas,
 * detection sampler, timeline, click-to-proof seeks):
 *
 *   ProceduralSource — a deterministic, seekable "synthesized CCTV" renderer.
 *                      render(t) is a pure function of t: perfect scrubbing and
 *                      byte-identical replays, zero asset downloads.
 *   VideoFileSource  — a real user-uploaded .mp4/.webm via <video> + blob URL.
 */

import { clamp } from "./time";

export interface SceneSpec {
  id: string;
  title: string;
  subtitle: string;
  camLabel: string;
  /** seconds */
  duration: number;
  render: (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void;
}

export abstract class FrameSource {
  private listeners = new Set<() => void>();
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  protected emit(): void {
    for (const cb of this.listeners) cb();
  }
  abstract readonly kind: "procedural" | "file";
  abstract get duration(): number;
  abstract get currentTime(): number;
  abstract get playing(): boolean;
  abstract play(): void;
  abstract pause(): void;
  abstract seek(t: number): void;
  abstract renderInto(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  abstract dispose(): void;
  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }
}

/* ---------------------------- procedural source ---------------------------- */

export class ProceduralSource extends FrameSource {
  readonly kind = "procedural" as const;
  private scene: SceneSpec;
  private raf = 0;
  private anchorPerf = 0;
  private baseT = 0;
  private t = 0;
  private isPlaying = false;

  constructor(scene: SceneSpec) {
    super();
    this.scene = scene;
  }

  get duration(): number {
    return this.scene.duration;
  }
  get currentTime(): number {
    return this.t;
  }
  get playing(): boolean {
    return this.isPlaying;
  }

  play(): void {
    if (this.isPlaying) return;
    if (this.t >= this.duration) {
      this.t = 0;
      this.baseT = 0;
    }
    this.baseT = this.t;
    this.anchorPerf = performance.now();
    this.isPlaying = true;
    const loop = () => {
      if (!this.isPlaying) return;
      this.t = this.baseT + (performance.now() - this.anchorPerf) / 1000;
      if (this.t >= this.duration) {
        this.t = this.duration;
        this.isPlaying = false;
        this.emit();
        return;
      }
      this.emit();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.emit();
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  seek(t: number): void {
    this.t = clamp(t, 0, this.duration);
    this.baseT = this.t;
    this.anchorPerf = performance.now();
    this.emit();
  }

  renderInto(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.scene.render(ctx, this.t, w, h);
  }

  dispose(): void {
    this.isPlaying = false;
    cancelAnimationFrame(this.raf);
  }
}

/* ------------------------------ video file source -------------------------- */

export class VideoFileSource extends FrameSource {
  readonly kind = "file" as const;
  private video: HTMLVideoElement;
  private url: string;
  private objectUrl = false;
  private ready = false;
  private dur = 0;

  /** Accepts a user-picked File (blob URL) or a bundled asset URL / data URI. */
  constructor(src: File | string) {
    super();
    if (typeof src === "string") {
      this.url = src;
    } else {
      this.url = URL.createObjectURL(src);
      this.objectUrl = true;
    }
    this.video = document.createElement("video");
    this.video.src = this.url;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.crossOrigin = "anonymous";
    const fwd = () => this.emit();
    this.video.addEventListener("loadedmetadata", () => {
      this.ready = true;
      this.dur = this.video.duration || 0;
      fwd();
    });
    this.video.addEventListener("timeupdate", fwd);
    this.video.addEventListener("play", fwd);
    this.video.addEventListener("pause", fwd);
    this.video.addEventListener("ended", fwd);
    this.video.addEventListener("seeked", fwd);
  }

  get duration(): number {
    return this.dur;
  }
  get currentTime(): number {
    return this.video.currentTime;
  }
  get playing(): boolean {
    return !this.video.paused && !this.video.ended;
  }
  play(): void {
    if (!this.ready) return;
    void this.video.play().catch(() => undefined);
  }
  pause(): void {
    this.video.pause();
  }
  seek(t: number): void {
    if (!this.ready) return;
    this.video.currentTime = clamp(t, 0, Math.max(0, this.duration - 0.05));
  }
  renderInto(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const vw = this.video.videoWidth || 16;
    const vh = this.video.videoHeight || 9;
    // cover-fit
    const scale = Math.max(w / vw, h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    try {
      ctx.drawImage(this.video, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } catch {
      // decoder not ready yet — skip frame
    }
  }
  dispose(): void {
    this.video.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.url);
  }
}
