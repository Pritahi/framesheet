# FrameSheet — Implementation Tasks

Traceability: each task lists the requirements it implements (`.kiro/specs/framesheet-engine/requirements.md`).

- [x] **1. Gate 1 — Hysteresis segmenter** (`src/engine/segmenter.ts`) — R2.1–R2.5
  - [x] 1.1 IDLE/ARMING/ACTIVE/COOLING pure state machine with retroactive anchoring
  - [x] 1.2 `flushSegmenter` for pause/end/seek — R2.6
- [x] **2. Dual-mode detector** (`src/engine/detector.ts`) — R1.1–R1.5
  - [x] 2.1 192×108 luma grid + zone frame-diff motion signal
  - [x] 2.2 Background model, 3×3 dilation, connected components, classify/track
  - [x] 2.3 Background-anchor freezing + ghost fast-release (stationary dwellers)
- [x] **3. Frame sources** (`src/engine/source.ts`) — R6.1
  - [x] 3.1 `ProceduralSource` — deterministic pure render(t), rAF clock, hard seek
  - [x] 3.2 `VideoFileSource` — blob URL upload plumbing
- [x] **4. Synthesized CCTV scenarios** (`src/demo/*`) — R6.1, scripted ground truth
  - [x] 4.1 Retail Checkout (3 waits incl. 38s bottleneck + step-out merge + noise blips)
  - [x] 4.2 Factory Packing (3 cycles + 26.6s tangled-tape anomaly + conveyor passes)
  - [x] 4.3 Loading Dock (vehicle dwells + forklift class-filter demo)
- [x] **5. Detection runner** (`src/engine/runner.ts`) — R1.2, R2.6, R2.7, R5.3
  - [x] 5.1 10Hz sampler → detector → per-zone segmenter → store
  - [x] 5.2 seek/source-change resets; proof auto-stop at segment end
- [x] **6. Studio store** (`src/store.ts`) — event intake w/ overlap dedupe (R2.7), zones,
  live segments, sheet, thresholds, proof state, toasts — R3.1
- [x] **7. Formula engine** (`src/engine/formulas.ts`) — R4.1–R4.4
  - [x] 7.1 tokenizer + recursive-descent parser (refs, arithmetic, comparisons, IF)
  - [x] 7.2 evaluator with memoized sheet pass, cycle detection, proof linkage
  - [x] 7.3 autocomplete suggestion list
- [x] **8. Studio UI** (`src/components/*`) — R3.1–R3.3, R5.1–R5.3, R6.2, R6.3
  - [x] 8.1 Video stage: zone draw/move/resize, blob overlay, proof banner
  - [x] 8.2 Timeline scrubber with status-colored event bars + ruler
  - [x] 8.3 Zone panel: mode/class selects, sliders, live 4-phase state-machine viz
  - [x] 8.4 Summary sheet grid with formula bar + click-to-proof highlight
  - [x] 8.5 Event log: verify/edit/dismiss, manual mark (I/O), CSV + TSV export
- [x] **9. Property-based tests** (`src/engine/__tests__/*.test.ts`) — invariants
  P-NOISE, P-ANCHOR, P-MERGE, P-SPLIT, P-BOUNDS, P-FLUSH, F-LINK, F-AGG, F-ROBUST
  via fast-check (`npx vitest run`)
- [x] **10. Real-footage e2e** (`realvideo.e2e.test.ts`) — a real card-payment
  close-up video is decoded by ffmpeg at exactly the app's 192×108 @10Hz settings
  and pushed through the production `ZoneDetector.analyzeLuma()` + segmenter;
  asserts payment-activity events are found with sane bounds (auto-skips without fixture)

- [x] **11. CV diagnostics overlay** — R7.1–R7.3
  - [x] 11.1 detector emits an optional per-pixel class mask (zero cost when off)
  - [x] 11.2 runner measures sampler Hz + rolling ms/frame onto the telemetry channel
  - [x] 11.3 Stage paints the mask (pixelated, screen-blend) + HUD + legend
- [x] **12. Presets & area-aware auto-calibration** — R8.1–R8.4
- [x] **13. Bundled REAL footage scenario** — R6.1b
  - [x] 13.1 clip trimmed/compressed to 38KB, inlined via `?inline` (single-file build intact)
  - [x] 13.2 shared `REAL_FOOTAGE_ZONES()` preset used by BOTH the UI and the e2e test
  - [x] 13.3 attribution surfaced in the video chrome
- [x] **14. Onboarding** — 4-step "How it works" modal with a real-footage shortcut

## Verification

- `npm run build` — clean production bundle (vite single-file)
- `npx vitest run` — all property suites green (100+ generated cases per property)
- `npx vitest run realvideo` — real-footage e2e: 14s tap-to-pay clip yields
  4 clean events across 2 zones (e.g. terminal ROI 3.1→4.4s and 7.1→8.0s)
