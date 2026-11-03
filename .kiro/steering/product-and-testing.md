# FrameSheet — Product & Testing Steering

These rules govern ALL code in this repository. Kiro agents must read this file before
editing anything under `src/engine/`.

## Product Principles

1. **Driver's-seat UX.** Every detection parameter (mode, class, sensitivity/occupancy,
   start-hold, merge-gap) is user-visible and user-tunable LIVE. No hidden magic constants
   that materially affect event boundaries may exist outside `ZoneConfig`.
2. **Proof over vibes.** Any number the app shows must be clickable traceable to video
   evidence (R5). If a feature cannot be proven in the player, it does not ship.
3. **Zero external APIs — absolute.** No network calls for media, models, telemetry, or fonts
   at runtime in the engine path. Detection runs on-device, period. Frame data NEVER leaves
   the browser. Violations of this rule are release blockers.
4. **Determinism.** Procedural scenes are pure functions of time. Same inputs ⇒ same event
   log (±0.1s sample quantization). No `Math.random()` in render paths — use `hash01()`.
5. **The stitched whole must feel native.** CV telemetry and spreadsheet cells share one
   design language (Haunted Industrial telemetry: obsidian, phosphor emerald, amber, crimson)
   and one store. No "two apps in an iframe" seams.

## Coding Standards

- `src/engine/*` is **pure & DOM-free** except `detector.ts` (single private canvas) and
  `source.ts` (source edge). Engines never import React or the store.
- The store (`src/store.ts`) is the only mutable cross-module state; engines communicate with
  it exclusively through the runner. UI never mutates engine state directly.
- Time is `number` seconds everywhere; milliseconds only in user-facing hysteresis params
  (converted at the segmenter boundary).
- Types are strict: no `any`, no non-null assertion in engine code, exhaustive `switch` on
  phase/kind unions.
- New formula functions register in ONE place (`evalCall` + `FORMULA_FUNCTIONS` for
  autocomplete) with arity checked and `#ERR` semantics — never throw past the evaluator.
- Icons come from lucide-react. No emojis in UI strings.

## Testing Philosophy

- **Property-based first** for engines: fast-check suites encode the invariants in
  `requirements.md §Acceptance Invariants`. When a bug is found, first write the failing
  property, shrink it, then fix.
- Minimum property coverage to touch segmenter/formulas: P-NOISE, P-ANCHOR, P-MERGE,
  P-SPLIT, P-BOUNDS, P-FLUSH, F-AGG, F-ROBUST.
- Rendering/DOM is verified via the three scripted ground-truth scenarios (documented in each
  `src/demo/*.ts` header) — expected segment counts and bottleneck timings are part of the
  scenario contract.
- Perf budget: detector sample ≤ 2ms on a 2019 laptop at 192×108; render ≤ 8ms/frame.
- Run the suite: `npx vitest run`. Build: `npm run build`.
