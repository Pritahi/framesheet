import { Fragment, useMemo, useRef, useState } from "react";
import { FunctionSquare, Play, Table2 } from "lucide-react";
import { studio, useStudioVersion, SHEET_ADDRS } from "../store";
import {
  evaluateSheet,
  suggestFunctions,
  type EvalOutcome,
  type EventLike,
} from "../engine/formulas";
import { FORMULA_FUNCTIONS } from "../engine/formulas";
import { cn } from "../utils/cn";

const COLS = ["A", "B", "C", "D"];
const ROWS = [1, 2, 3, 4, 5, 6];

function cellClasses(out: EvalOutcome, raw: string, addr: string): string {
  const isHeader = addr.startsWith("A") || ["A1", "B1", "C1", "D1"].includes(addr);
  if (out.kind === "error") return "text-red-400 font-mono";
  if (!raw.startsWith("=")) {
    return isHeader
      ? "text-dim font-mono uppercase tracking-[0.18em] text-[8.5px]"
      : "text-ink";
  }
  if (out.kind === "number") return "text-emerald-200 font-mono justify-end";
  if (out.display === "BOTTLENECK ALERT") return "text-red-400 font-mono font-bold animate-pulse";
  if (out.display === "NORMAL") return "text-emerald-400 font-mono font-bold";
  return "text-sky-200 font-mono";
}

export function SummarySheet() {
  useStudioVersion();
  const fxRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);

  const eventsLike: EventLike[] = useMemo(
    () =>
      studio.events.map((e) => ({
        id: e.id,
        zoneName: e.zoneName,
        duration: e.duration,
        start: e.start,
        dismissed: e.verified === "DISMISSED",
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studio.events]
  );

  const outcomes = useMemo(
    () => evaluateSheet(studio.sheet, eventsLike),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studio.sheet, eventsLike]
  );

  const selected = studio.selectedCell;
  const raw = studio.sheet[selected] ?? "";
  const suggestions = raw.startsWith("=") ? suggestFunctions(raw.slice(1, cursor || undefined)) : [];
  const errorCount = SHEET_ADDRS.filter((a) => outcomes[a]?.kind === "error").length;

  const commitText = (text: string) => {
    studio.setCell(selected, text);
  };

  const onKeyNav = (e: React.KeyboardEvent) => {
    const col = COLS.indexOf(selected[0]);
    const row = parseInt(selected.slice(1), 10);
    let nc = col;
    let nr = row;
    if (e.key === "Tab" && !e.shiftKey) nc = (col + 1) % 4;
    else if (e.key === "Tab" && e.shiftKey) nc = (col + 3) % 4;
    else if (e.key === "ArrowRight") nc = Math.min(3, col + 1);
    else if (e.key === "ArrowLeft") nc = Math.max(0, col - 1);
    else if (e.key === "ArrowDown" || e.key === "Enter") nr = Math.min(6, row + 1);
    else if (e.key === "ArrowUp") nr = Math.max(1, row - 1);
    else return;
    e.preventDefault();
    studio.setSelectedCell(`${COLS[nc]}${nr}`);
  };

  return (
    <section className="panel hud-corners relative shrink-0">
      <div className="flex h-9 items-center gap-2 border-b border-line bg-panel2/70 px-3">
        <Table2 className="h-3.5 w-3.5 text-emerald-300" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink">
          Summary sheet · live formulas
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[9px] text-dim">
          {errorCount > 0 ? <span className="text-red-400">{errorCount} ERR</span> : "all cells OK"}
        </span>
      </div>

      {/* formula bar */}
      <div className="relative flex items-center gap-2 border-b border-line bg-obsidian/60 px-3 py-1.5">
        <FunctionSquare className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" />
        <span className="w-7 shrink-0 rounded border border-line bg-panel2 px-1 text-center font-mono text-[10px] font-bold text-emerald-300">
          {selected}
        </span>
        <input
          ref={fxRef}
          id="fx-input"
          value={raw}
          onChange={(e) => {
            commitText(e.target.value);
            setCursor(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={onKeyNav}
          onSelect={(e) => setCursor((e.target as HTMLInputElement).selectionStart ?? 0)}
          spellCheck={false}
          placeholder='=MAX_DURATION("Zone_A")'
          className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 font-mono text-[12px] text-ink outline-none transition-colors focus:border-emerald-400/40 focus:bg-panel2/60"
        />
        {suggestions.length > 0 && (
          <div className="absolute left-12 top-full z-30 mt-1 w-80 overflow-hidden rounded-md border border-line bg-obsidian shadow-2xl">
            {suggestions.map((f) => (
              <button
                key={f.name}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const before = raw.slice(0, cursor || raw.length);
                  const partial = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before)?.[1] ?? "";
                  const next =
                    before.slice(0, before.length - partial.length) + f.signature + raw.slice(cursor || raw.length);
                  commitText(next);
                  fxRef.current?.focus();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-emerald-400/10"
              >
                <span className="font-mono text-[11px] text-emerald-300">={f.signature}</span>
                <span className="ml-auto font-mono text-[9px] text-dim">{f.doc}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* grid */}
      <div className="blueprint p-2">
        <div className="grid grid-cols-[26px_repeat(4,minmax(0,1fr))] gap-px overflow-hidden rounded-md border border-line bg-line/60">
          <div className="h-6 bg-panel2" />
          {COLS.map((c) => (
            <div
              key={c}
              className="grid h-6 place-items-center bg-panel2 font-mono text-[9px] font-bold tracking-[0.3em] text-dim"
            >
              {c}
            </div>
          ))}
          {ROWS.map((r) => (
            <Fragment key={r}>
              <div className="grid h-8 place-items-center bg-panel2 font-mono text-[9px] text-dim">
                {r}
              </div>
              {COLS.map((c) => {
                const addr = `${c}${r}`;
                const cellRaw = studio.sheet[addr] ?? "";
                const out = outcomes[addr] ?? { kind: "empty", display: "" };
                const isSel = selected === addr;
                const hasProof = (out.proofEventIds?.length ?? 0) > 0;
                return (
                  <button
                    key={addr}
                    data-cell={addr}
                    onClick={() => {
                      studio.setSelectedCell(addr);
                      if (hasProof) studio.proveFromEvents(out.proofEventIds!);
                    }}
                    onDoubleClick={() => fxRef.current?.focus()}
                    title={out.kind === "error" ? out.error : hasProof ? "Click = replay proof segment" : cellRaw}
                    className={cn(
                      "relative flex h-8 items-center overflow-hidden px-2 text-left text-[11px] transition-all",
                      isSel
                        ? "bg-emerald-400/10 shadow-[inset_0_0_0_1.5px_rgba(52,211,153,0.8)]"
                        : "bg-obsidian/90 hover:bg-panel2/80",
                      cellClasses(out as EvalOutcome, cellRaw, addr)
                    )}
                  >
                    <span className="truncate">{out.display}</span>
                    {hasProof && (
                      <span className="absolute right-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full bg-emerald-400/20 text-emerald-300">
                        <Play className="h-2 w-2 fill-current" />
                      </span>
                    )}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {/* quick-insert function chips */}
      <div className="flex flex-wrap items-center gap-1 border-t border-line px-2.5 py-2">
        <span className="mr-1 font-mono text-[8.5px] uppercase tracking-[0.2em] text-dim">insert:</span>
        {FORMULA_FUNCTIONS.map((f) => (
          <button
            key={f.name}
            onClick={() => {
              studio.setCell(selected, `=${f.signature}`);
              fxRef.current?.focus();
            }}
            className="rounded border border-line bg-panel2 px-1.5 py-0.5 font-mono text-[9px] text-dim transition-colors hover:border-emerald-400/50 hover:text-emerald-300"
          >
            {f.name}
          </button>
        ))}
      </div>
    </section>
  );
}
