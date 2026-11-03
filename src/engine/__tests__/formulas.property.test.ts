/**
 * Property-based verification of the formula engine (F-AGG, F-LINK, F-IF,
 * F-ARITH, F-ROBUST invariants from the spec). Run: npx vitest run
 */

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { evaluateSheet, type EventLike } from "../formulas";

const ZONE_NAMES = ["Zone_A", "Zone_B", "Zone_C"];

const eventArb = fc.record({
  id: fc.uuid(),
  zoneName: fc.constantFrom(...ZONE_NAMES),
  duration: fc.double({ min: 0.2, max: 90, noNaN: true }),
  start: fc.double({ min: 0, max: 300, noNaN: true }),
  dismissed: fc.boolean(),
});

const eventsArb = fc.array(eventArb, { minLength: 0, maxLength: 24 });

const live = (evs: EventLike[], zone: string) =>
  evs.filter((e) => !e.dismissed && e.zoneName === zone);

const evalCell = (raw: string, evs: EventLike[], cells: Record<string, string> = {}) =>
  evaluateSheet({ A1: raw, ...cells }, evs)["A1"];

const closeTo = (a: number, b: number, tol = 1e-2) => Math.abs(a - b) <= tol;

describe("formulas · F-AGG (oracle equivalence)", () => {
  it("COUNT_EVENTS / AVG / SUM / COUNT_OVER match naive recomputation", () => {
    fc.assert(
      fc.property(
        eventsArb,
        fc.constantFrom(...ZONE_NAMES),
        fc.integer({ min: 1, max: 60 }),
        (evs, zone, over) => {
          const expected = live(evs, zone);
          const c1 = evalCell(`=COUNT_EVENTS("${zone}")`, evs);
          expect(c1.kind).toBe("number");
          expect(c1.value).toBe(expected.length);

          const s = evalCell(`=SUM_DURATION("${zone}")`, evs);
          const naiveSum = expected.reduce((a, e) => a + e.duration, 0);
          expect(closeTo(Number(s.value), Math.round(naiveSum * 100) / 100, 0.05)).toBe(true);

          const a = evalCell(`=AVG_DURATION("${zone}")`, evs);
          const naiveAvg = expected.length ? naiveSum / expected.length : 0;
          expect(closeTo(Number(a.value), naiveAvg, 0.05)).toBe(true);

          const o = evalCell(`=COUNT_OVER("${zone}", ${over})`, evs);
          const naiveOver = expected.filter((e) => e.duration > over);
          expect(o.value).toBe(naiveOver.length);
          expect(o.proofEventIds?.slice().sort()).toEqual(naiveOver.map((e) => e.id).sort());
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("formulas · F-LINK (proof linkage)", () => {
  it("MAX/MIN link to the extremal event of the zone", () => {
    fc.assert(
      fc.property(eventsArb, fc.constantFrom(...ZONE_NAMES), (evs, zone) => {
        const list = live(evs, zone);
        const mx = evalCell(`=MAX_DURATION("${zone}")`, evs);
        const mn = evalCell(`=MIN_DURATION("${zone}")`, evs);
        if (list.length === 0) {
          expect(mx.value).toBe(0);
          expect(mx.proofEventIds ?? []).toHaveLength(0);
          return;
        }
        const naiveMax = Math.max(...list.map((e) => e.duration));
        const naiveMin = Math.min(...list.map((e) => e.duration));
        expect(closeTo(Number(mx.value), naiveMax, 0.01)).toBe(true);
        expect(closeTo(Number(mn.value), naiveMin, 0.01)).toBe(true);
        const maxEv = list.find((e) => e.id === mx.proofEventIds?.[0]);
        const minEv = list.find((e) => e.id === mn.proofEventIds?.[0]);
        expect(maxEv?.duration).toBeCloseTo(naiveMax, 5);
        expect(minEv?.duration).toBeCloseTo(naiveMin, 5);
      }),
      { numRuns: 200 }
    );
  });
});

describe("formulas · F-IF + cell refs", () => {
  it("IF matches native conditional semantics over referenced numeric cells", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 100 }),
        fc.integer({ min: -50, max: 100 }),
        (cellVal, threshold) => {
          const res = evalCell(`=IF(B2 > ${threshold}, "HOT", "COLD")`, [], { B2: String(cellVal) });
          expect(res.kind).toBe("text");
          expect(res.value).toBe(cellVal > threshold ? "HOT" : "COLD");
        }
      ),
      { numRuns: 200 }
    );
  });

  it(" cycles are reported as #CYCLE, never thrown", () => {
    const out = evaluateSheet({ A1: "=B1+1", B1: "=A1+1" }, []);
    expect(out.A1.kind).toBe("error");
    expect(out.B1.kind).toBe("error");
  });
});

describe("formulas · F-ARITH", () => {
  interface Arith {
    v: number;
    s: string;
  }
  const leaf: fc.Arbitrary<Arith> = fc
    .integer({ min: -40, max: 40 })
    .map((n) => ({ v: n, s: `(${n})` }));
  const opArb: fc.Arbitrary<"+" | "-" | "*"> = fc.constantFrom("+", "-", "*");
  const arith: (depth: number) => fc.Arbitrary<Arith> = fc.memo(
    (depth: number): fc.Arbitrary<Arith> => {
      if (depth <= 1) return leaf;
      return fc.oneof(
        leaf,
        fc.tuple(arith(depth - 1), arith(depth - 1), opArb).map(([a, b, op]) => ({
          v: op === "+" ? a.v + b.v : op === "-" ? a.v - b.v : a.v * b.v,
          s: `(${a.s} ${op} ${b.s})`,
        }))
      );
    }
  );
  const arithArb = arith(4);

  it("fully-parenthesised arithmetic evaluates like JavaScript", () => {
    fc.assert(
      fc.property(arithArb, (ast) => {
        const res = evalCell(`=${ast.s}`, []);
        expect(res.kind).toBe("number");
        expect(closeTo(Number(res.value), ast.v, Math.max(0.01, Math.abs(ast.v) * 1e-6))).toBe(true);
      }),
      { numRuns: 300 }
    );
  });
});

describe("formulas · F-ROBUST", () => {
  it("arbitrary input never throws — every cell yields a defined outcome", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 10 }), (texts) => {
        const cells: Record<string, string> = {};
        texts.forEach((t, i) => {
          cells[`A${i + 1}`] = t;
        });
        const out = evaluateSheet(cells, [
          { id: "e1", zoneName: "Zone_A", duration: 3, start: 0, dismissed: false },
        ]);
        for (const k of Object.keys(cells)) {
          expect(["empty", "number", "text", "error"]).toContain(out[k].kind);
          expect(typeof out[k].display).toBe("string");
        }
      }),
      { numRuns: 200 }
    );
  });

  it("dismissed events are excluded from every aggregate", () => {
    const evs: EventLike[] = [
      { id: "a", zoneName: "Zone_A", duration: 10, start: 0, dismissed: false },
      { id: "b", zoneName: "Zone_A", duration: 40, start: 20, dismissed: true },
    ];
    expect(evalCell('=COUNT_EVENTS("Zone_A")', evs).value).toBe(1);
    expect(evalCell('=MAX_DURATION("Zone_A")', evs).value).toBe(10);
    expect(evalCell('=COUNT_OVER("Zone_A", 5)', evs).value).toBe(1);
  });
});
