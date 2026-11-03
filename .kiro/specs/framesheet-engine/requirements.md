# FrameSheet Engine — Requirements (EARS Notation)

**Spec ID:** `framesheet-engine` · **Hackathon:** Kiroween 2026 · **Category:** Frankenstein
**Scope:** client-side zone activity detection, hysteresis segmentation, reactive formula sheet,
click-to-proof video synchronization, and export.

Glossary: *Zone* = user-drawn region of interest on the video plane. *Segment* = a completed
`[startTime, endTime]` activity record. *Signal* = the per-sample detector output for one zone.

---

## R1 — Dual-Mode Detection

- **R1.1 (Ubiquitous)** The system shall perform all detection 100% client-side with zero network
  calls, zero paid APIs, and no frame data ever leaving the browser.
- **R1.2 (Event-driven)** WHEN the player is running, THE SYSTEM SHALL sample the frame at a fixed
  cadence of 10Hz and produce one signal per enabled zone per sample.
- **R1.3 (State-driven)** WHILE a zone is in MOTION mode, THE SYSTEM SHALL compute the signal as the
  active-pixel fraction of the zone rectangle: the share of pixels whose frame-to-frame luma change
  exceeds a fixed noise gate (18/255), which rejects sub-gate light flicker exactly.
- **R1.4 (State-driven)** WHILE a zone is in OBJECT mode, THE SYSTEM SHALL derive the signal from
  connected-component foreground blobs (background-differenced, 3×3 dilated) classified by
  size/aspect into `person | vehicle | package`, gated by the zone's target class and by the
  fraction of the tracked blob inside the zone (`overlap`).
- **R1.5 (Unwanted behavior)** IF a tracked object stops moving inside the zone, THEN THE SYSTEM
  SHALL freeze background adaptation under the object's bounding box so the object is not absorbed
  into the background model (stationary dwellers must continue to register).

## R2 — Hysteresis / Debounce State Machine

- **R2.1 (Event-driven)** WHEN a zone signal transitions to active, THE SYSTEM SHALL enter an
  ARMING phase and shall not record a start until the signal has remained active for at least
  `startHoldMs` (default 800ms).
- **R2.2 (Unwanted behavior)** IF a signal burst lasts less than `startHoldMs`, THEN THE SYSTEM
  SHALL discard it and emit no segment (single-frame flicker must never become a row).
- **R2.3 (Event-driven)** WHEN a segment is confirmed, THE SYSTEM SHALL anchor its `startTime` to
  the timestamp of the first active sample of the candidate run (the hold duration is recovered,
  not lost).
- **R2.4 (State-driven)** WHILE ACTIVE, IF the signal drops for less than `gapMergeMs`
  (default 1500ms), THEN THE SYSTEM SHALL merge the subsequent active run into the same segment.
- **R2.5 (Event-driven)** WHEN inactivity persists for at least `gapMergeMs`, THE SYSTEM SHALL
  complete the segment with `endTime` equal to the timestamp of the last active sample.
- **R2.6 (Event-driven)** WHEN playback is paused, ended, or seeked, THE SYSTEM SHALL flush any
  open segment using its last active timestamp and clear all detector state.
- **R2.7 (Complex)** WHEN seeked or replayed over a time range that already produced a segment,
  THE SYSTEM SHALL suppress duplicate segments whose IoU overlap with an existing same-zone
  event exceeds 0.45.

## R3 — Driver's-Seat Controls & Human Override

- **R3.1 (Ubiquitous)** The system shall expose per-zone controls for mode, target class,
  sensitivity/occupancy threshold, `startHoldMs`, and `gapMergeMs`, effective live without restart.
- **R3.2 (Event-driven)** WHEN the operator presses `I`, THE SYSTEM SHALL open a manual mark at the
  current playhead on the selected zone; WHEN `O` is pressed, THE SYSTEM SHALL close it as a MANUAL
  segment.
- **R3.3 (Event-driven)** WHEN the operator verifies, edits, or dismisses an event row, THE SYSTEM
  SHALL persist that state and exclude DISMISSED rows from all formula aggregates.

## R4 — Reactive Formula Sheet

- **R4.1 (Ubiquitous)** The sheet shall support `COUNT_EVENTS`, `AVG_DURATION`, `MAX_DURATION`,
  `MIN_DURATION`, `SUM_DURATION`, `COUNT_OVER(zone, seconds)`, and `IF(cond, then, else)` over
  cell refs, arithmetic, comparisons, string/number literals.
- **R4.2 (Event-driven)** WHEN any event is added, edited, dismissed, or re-verified, THE SYSTEM
  SHALL re-evaluate all formula cells deterministically in the same render pass.
- **R4.3 (Unwanted behavior)** IF a formula is malformed, references an unknown function, divides
  by zero, or forms a reference cycle, THEN THE SYSTEM SHALL render `#ERR`/`#CYCLE` in that cell
  without throwing or corrupting other cells.
- **R4.4 (Event-driven)** WHEN a formula's text is being edited, THE SYSTEM SHALL offer
  autocomplete for supported function names with signatures.

## R5 — Click-to-Proof Synchronization

- **R5.1 (Event-driven)** WHEN the operator clicks an event row, THE SYSTEM SHALL seek the player
  to `startTime − 0.12s`, flash the corresponding zone rectangle, display an evidence banner with
  event number and mm:ss range, and play exactly through `endTime`.
- **R5.2 (Event-driven)** WHEN the operator clicks a formula cell carrying proof linkage
  (MAX/MIN/COUNT_OVER), THE SYSTEM SHALL replay the linked event (the longest match for
  COUNT_OVER) per R5.1.
- **R5.3 (State-driven)** WHILE proof playback is active, THE SYSTEM SHALL stop automatically at
  the segment end and keep the banner for ≈1.4s.

## R7 — CV Diagnostics (explainability)

- **R7.1 (Event-driven)** WHEN the operator enables the CV Mask toggle, THE SYSTEM SHALL overlay
  the detector's own 192×108 per-pixel classification on the video plane, colour-coded
  motion (frame-diff) / foreground (background model) / both.
- **R7.2 (State-driven)** WHILE diagnostics are enabled, THE SYSTEM SHALL display live sampler
  rate (Hz), rolling per-sample detector cost (ms), and tracked blob count.
- **R7.3 (Ubiquitous)** Diagnostics shall cost nothing when disabled: the mask buffer is only
  allocated and the foreground pipeline only forced while the toggle is on.

## R8 — Presets & Area-Aware Auto-Calibration

- **R8.1 (Ubiquitous)** Each zone shall offer one-click presets — Quick Tap (300ms/5%),
  Standard Cycle (800ms/8%), Long Dwell (1200ms/10%) — derived from real-footage trials.
- **R8.2 (Event-driven)** WHEN Auto-Calibrate is pressed, THE SYSTEM SHALL sample ~1.6s of that
  zone's live signal and set the threshold just above the observed noise ceiling
  (p90 × 1.8 for motion, p90 × 1.4 for occupancy), clamped to the valid slider range.
- **R8.3 (Unwanted behavior)** IF the feed is paused or too few samples arrive, THEN THE SYSTEM
  SHALL abort calibration with an explanatory toast and leave settings unchanged.
- **R8.4 (Rationale)** Because a localized action covers a smaller FRACTION of a larger ROI,
  sampling the actual zone (rather than using a constant) is what makes calibration area-aware.

## R6 — Demo Scenarios & Export

- **R6.1 (Ubiquitous)** The app shall ship three instant procedural scenarios (Retail Checkout,
  Factory Packing, Loading Dock) synthesized deterministically so `render(t)` is a pure function —
  plus drag-and-drop `.mp4/.webm` upload.
- **R6.1b (Ubiquitous)** The app shall additionally bundle one REAL camera clip
  (card-terminal contactless payment, ~38KB, inlined as a data URI so the single-file build
  stays self-contained) pre-tuned with the Quick Tap preset, so real-footage detection and
  Click-to-Proof are reachable in one click with no file hunting. Attribution shall be shown
  in the UI (Pexels #5101679, Gustavo Fring — Pexels License).
- **R6.2 (Ubiquitous)** The app shall render an event timeline scrubber with color-coded duration
  bars (emerald normal / amber slow / crimson bottleneck) that seek on click.
- **R6.3 (Event-driven)** WHEN the operator exports, THE SYSTEM SHALL produce RFC-4180 CSV
  download and clipboard TSV paste-ready for Google Sheets/Excel, excluding dismissed rows.

## Acceptance Invariants (machine-checked, see tasks.md §8)

- **P-NOISE** bursts < startHold emit nothing.
- **P-ANCHOR** segment.start == first-rise timestamp.
- **P-MERGE** gaps < gapMerge never split a segment.
- **P-SPLIT** gaps ≥ gapMerge always split, end == last active sample.
- **P-BOUNDS** end > start, 0 ≤ peak ≤ 1, segments ordered & non-overlapping.
- **P-FLUSH** an open ACTIVE/COOLING segment flushes exactly once.
- **F-LINK** MAX/MIN_DURATION's proof link resolves to the event with extremal duration.
- **F-AGG** COUNT_EVENTS/AVG/SUM/COUNT_OVER == naive recomputation over the event list.
- **F-ROBUST** arbitrary text never crashes the evaluator (result is a value or an error object).
