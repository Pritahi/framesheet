/**
 * FrameSheet — reactive spreadsheet formula engine.
 *
 * Pure tokenizer → recursive-descent parser → evaluator with cycle detection.
 * Supported surface (Kiroween spec):
 *
 *   =COUNT_EVENTS("Zone_A")
 *   =AVG_DURATION("Zone_A")     =MIN_DURATION("Zone_A")
 *   =MAX_DURATION("Zone_A")     =SUM_DURATION("Zone_A")
 *   =COUNT_OVER("Zone_A", 20)
 *   =IF(B4 > 25, "BOTTLENECK ALERT", "NORMAL")
 *   cell refs (A1..D6), arithmetic + - * /, comparisons > < >= <= = !=,
 *   parentheses, string & number literals.
 *
 * The evaluator returns rich outcomes including `proofEventIds` so a cell like
 * =MAX_DURATION("Zone_A") links directly to the worst-case event video segment.
 */

export interface EventLike {
  id: string;
  zoneName: string;
  /** seconds */
  duration: number;
  start: number;
  dismissed: boolean;
}

export type CellValue = number | string;

export interface EvalOutcome {
  kind: "empty" | "number" | "text" | "error";
  /** raw computed value (number|string) when not empty/error */
  value?: CellValue;
  /** text rendered in the cell */
  display: string;
  error?: string;
  /** events this cell can "prove" on click (MAX/MIN/COUNT_OVER) */
  proofEventIds?: string[];
}

/* ---------------------------------- tokens --------------------------------- */

type TokType =
  | "NUM"
  | "STR"
  | "IDENT"
  | "CELL"
  | "OP"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "END";

interface Tok {
  type: TokType;
  text: string;
  num?: number;
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let out = "";
      while (j < src.length && src[j] !== '"') {
        out += src[j];
        j++;
      }
      if (j >= src.length) throw new Error("Unterminated string");
      toks.push({ type: "STR", text: out });
      i = j + 1;
      continue;
    }
    const dm = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i));
    if (dm) {
      toks.push({ type: "NUM", text: dm[0], num: parseFloat(dm[0]) });
      i += dm[0].length;
      continue;
    }
    const cell = /^[A-Za-z]{1,2}[0-9]{1,2}\b/.exec(src.slice(i));
    if (cell) {
      toks.push({ type: "CELL", text: cell[0].toUpperCase() });
      i += cell[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      toks.push({ type: "IDENT", text: id[0].toUpperCase() });
      i += id[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "!=" || two === "==") {
      toks.push({ type: "OP", text: two === "==" ? "=" : two });
      i += 2;
      continue;
    }
    if ("+-*/><=".includes(c)) {
      toks.push({ type: "OP", text: c });
      i++;
      continue;
    }
    if (c === "(") {
      toks.push({ type: "LPAREN", text: "(" });
      i++;
      continue;
    }
    if (c === ")") {
      toks.push({ type: "RPAREN", text: ")" });
      i++;
      continue;
    }
    if (c === ",") {
      toks.push({ type: "COMMA", text: "," });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  toks.push({ type: "END", text: "" });
  return toks;
}

/* ----------------------------------- AST ----------------------------------- */

type Ast =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "cell"; addr: string }
  | { kind: "call"; name: string; args: Ast[] }
  | { kind: "bin"; op: string; left: Ast; right: Ast }
  | { kind: "neg"; arg: Ast };

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok {
    return this.toks[this.pos];
  }
  private next(): Tok {
    return this.toks[this.pos++];
  }
  private expect(type: TokType, what: string): Tok {
    const t = this.next();
    if (t.type !== type) throw new Error(`Expected ${what}, got "${t.text || "end"}"`);
    return t;
  }

  parseExpr(): Ast {
    return this.parseComparison();
  }
  private parseComparison(): Ast {
    let left = this.parseAdditive();
    const t = this.peek();
    if (t.type === "OP" && [">", "<", ">=", "<=", "=", "!="].includes(t.text)) {
      this.next();
      const right = this.parseAdditive();
      left = { kind: "bin", op: t.text, left, right };
    }
    return left;
  }
  private parseAdditive(): Ast {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.type === "OP" && (t.text === "+" || t.text === "-")) {
        this.next();
        left = { kind: "bin", op: t.text, left, right: this.parseTerm() };
      } else return left;
    }
  }
  private parseTerm(): Ast {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === "OP" && (t.text === "*" || t.text === "/")) {
        this.next();
        left = { kind: "bin", op: t.text, left, right: this.parseUnary() };
      } else return left;
    }
  }
  private parseUnary(): Ast {
    const t = this.peek();
    if (t.type === "OP" && t.text === "-") {
      this.next();
      return { kind: "neg", arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }
  private parsePrimary(): Ast {
    const t = this.next();
    switch (t.type) {
      case "NUM":
        return { kind: "num", value: t.num ?? 0 };
      case "STR":
        return { kind: "str", value: t.text };
      case "CELL":
        return { kind: "cell", addr: t.text };
      case "LPAREN": {
        const e = this.parseExpr();
        this.expect("RPAREN", "')'");
        return e;
      }
      case "IDENT": {
        this.expect("LPAREN", "'(' after function name");
        const args: Ast[] = [];
        if (this.peek().type !== "RPAREN") {
          args.push(this.parseExpr());
          while (this.peek().type === "COMMA") {
            this.next();
            args.push(this.parseExpr());
          }
        }
        this.expect("RPAREN", "')'");
        return { kind: "call", name: t.text, args };
      }
      default:
        throw new Error(`Unexpected token "${t.text || "end"}"`);
    }
  }
}

export function parseFormula(src: string): Ast {
  const p = new Parser(tokenize(src));
  const ast = p.parseExpr();
  const end = p["toks"][p["pos"]];
  if (end.type !== "END") throw new Error(`Unexpected trailing "${end.text}"`);
  return ast;
}

/* -------------------------------- evaluator -------------------------------- */

export interface EvalContext {
  cells: Record<string, string>;
  events: EventLike[];
  resolveCell: (addr: string, stack: string[]) => EvalOutcome;
}

function truthy(v: CellValue): boolean {
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  return v.length > 0;
}

function zoneEvents(events: EventLike[], zone: string): EventLike[] {
  const want = zone.trim().toUpperCase();
  return events.filter((e) => !e.dismissed && e.zoneName.trim().toUpperCase() === want);
}

function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return "#NUM!";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

interface CallResult {
  value: CellValue;
  proofEventIds?: string[];
}

function evalCall(name: string, args: CellValue[], ctx: EvalContext): CallResult {
  const needZone = (i: number): string => {
    const v = args[i];
    if (typeof v !== "string") throw new Error(`${name}: argument ${i + 1} must be a zone name string`);
    return v;
  };
  const needNum = (i: number): number => {
    const v = args[i];
    if (typeof v !== "number") throw new Error(`${name}: argument ${i + 1} must be a number`);
    return v;
  };
  const durs = (zone: string) => zoneEvents(ctx.events, zone).map((e) => e.duration);
  const evs = (zone: string) => zoneEvents(ctx.events, zone);

  switch (name) {
    case "COUNT_EVENTS": {
      if (args.length !== 1) throw new Error("COUNT_EVENTS takes 1 argument");
      return { value: evs(needZone(0)).length };
    }
    case "SUM_DURATION": {
      if (args.length !== 1) throw new Error("SUM_DURATION takes 1 argument");
      const total = durs(needZone(0)).reduce((a, b) => a + b, 0);
      return { value: Math.round(total * 100) / 100 };
    }
    case "AVG_DURATION": {
      if (args.length !== 1) throw new Error("AVG_DURATION takes 1 argument");
      const ds = durs(needZone(0));
      if (ds.length === 0) return { value: 0 };
      return { value: Math.round((ds.reduce((a, b) => a + b, 0) / ds.length) * 100) / 100 };
    }
    case "MAX_DURATION": {
      if (args.length !== 1) throw new Error("MAX_DURATION takes 1 argument");
      const list = evs(needZone(0));
      if (list.length === 0) return { value: 0 };
      let best = list[0];
      for (const e of list) if (e.duration > best.duration) best = e;
      return { value: Math.round(best.duration * 100) / 100, proofEventIds: [best.id] };
    }
    case "MIN_DURATION": {
      if (args.length !== 1) throw new Error("MIN_DURATION takes 1 argument");
      const list = evs(needZone(0));
      if (list.length === 0) return { value: 0 };
      let best = list[0];
      for (const e of list) if (e.duration < best.duration) best = e;
      return { value: Math.round(best.duration * 100) / 100, proofEventIds: [best.id] };
    }
    case "COUNT_OVER": {
      if (args.length !== 2) throw new Error("COUNT_OVER takes 2 arguments (zone, seconds)");
      const threshold = needNum(1);
      const matches = evs(needZone(0)).filter((e) => e.duration > threshold);
      return {
        value: matches.length,
        proofEventIds: matches.map((m) => m.id),
      };
    }
    case "IF": {
      // handled lazily in evalAst to short-circuit branches
      throw new Error("IF must be evaluated by the interpreter");
    }
    default:
      throw new Error(`Unknown function ${name}()`);
  }
}

function evalAst(ast: Ast, ctx: EvalContext, stack: string[]): CellValue | CallResult {
  switch (ast.kind) {
    case "num":
      return { value: ast.value };
    case "str":
      return { value: ast.value };
    case "cell": {
      if (stack.includes(ast.addr)) throw new Error(`Circular reference ${ast.addr}`);
      const out = ctx.resolveCell(ast.addr, stack);
      if (out.kind === "error") throw new Error(`${ast.addr}: ${out.error ?? "error"}`);
      if (out.kind === "empty") return { value: 0 };
      return { value: out.value ?? 0 };
    }
    case "neg": {
      const r = evalAst(ast.arg, ctx, stack) as CallResult;
      if (typeof r.value !== "number") throw new Error("Cannot negate non-number");
      return { value: -r.value };
    }
    case "bin": {
      const l = (evalAst(ast.left, ctx, stack) as CallResult).value;
      const r = (evalAst(ast.right, ctx, stack) as CallResult).value;
      if (["+", "-", "*", "/"].includes(ast.op)) {
        if (typeof l !== "number" || typeof r !== "number")
          throw new Error(`Operator ${ast.op} needs numbers`);
        if (ast.op === "/" && r === 0) throw new Error("Division by zero");
        const v = ast.op === "+" ? l + r : ast.op === "-" ? l - r : ast.op === "*" ? l * r : l / r;
        return { value: Math.round(v * 10000) / 10000 };
      }
      // comparisons: numbers or strings, return 1/0
      if (typeof l === "number" && typeof r === "number") {
        const ok =
          ast.op === ">" ? l > r
          : ast.op === "<" ? l < r
          : ast.op === ">=" ? l >= r
          : ast.op === "<=" ? l <= r
          : ast.op === "=" ? l === r
          : l !== r;
        return { value: ok ? 1 : 0 };
      }
      const ls = String(l);
      const rs = String(r);
      const ok = ast.op === "=" ? ls === rs : ast.op === "!=" ? ls !== rs : false;
      if (!ok && ast.op !== "=" && ast.op !== "!=")
        throw new Error(`Operator ${ast.op} not valid on text`);
      return { value: ok ? 1 : 0 };
    }
    case "call": {
      if (ast.name === "IF") {
        if (ast.args.length !== 3) throw new Error("IF takes 3 arguments (cond, then, else)");
        const cond = (evalAst(ast.args[0], ctx, stack) as CallResult).value;
        const branch = truthy(cond) ? ast.args[1] : ast.args[2];
        const r = evalAst(branch, ctx, stack) as CallResult;
        return { value: r.value };
      }
      const args = ast.args.map((a) => (evalAst(a, ctx, stack) as CallResult).value);
      return evalCall(ast.name, args, ctx);
    }
  }
}

/** Evaluate one raw cell string (leading '=' => formula). */
export function evaluateCellRaw(
  _addr: string,
  raw: string,
  ctx: EvalContext,
  stack: string[] = []
): EvalOutcome {
  const text = raw ?? "";
  if (text.trim() === "") return { kind: "empty", display: "" };
  if (!text.startsWith("=")) {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) {
      return { kind: "number", value: n, display: fmtNumber(n) };
    }
    return { kind: "text", value: text, display: text };
  }
  try {
    const ast = parseFormula(text.slice(1));
    const r = evalAst(ast, ctx, stack) as CallResult;
    const v = r.value;
    if (typeof v === "number") {
      return { kind: "number", value: v, display: fmtNumber(v), proofEventIds: r.proofEventIds };
    }
    return { kind: "text", value: v, display: v, proofEventIds: r.proofEventIds };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "error", display: "#ERR", error: msg };
  }
}

/** Evaluate the whole sheet with memoization + cycle detection. */
export function evaluateSheet(
  cells: Record<string, string>,
  events: EventLike[]
): Record<string, EvalOutcome> {
  const cache = new Map<string, EvalOutcome>();
  const resolveCell = (addr: string, stack: string[]): EvalOutcome => {
    if (cache.has(addr)) return cache.get(addr)!;
    if (stack.includes(addr)) {
      return { kind: "error", display: "#CYCLE", error: `Circular reference ${addr}` };
    }
    // the resolving cell itself enters the chain so self-reference is caught
    const out = evaluateCellRaw(addr, cells[addr] ?? "", { cells, events, resolveCell }, [
      ...stack,
      addr,
    ]);
    cache.set(addr, out);
    return out;
  };
  const result: Record<string, EvalOutcome> = {};
  for (const addr of Object.keys(cells)) {
    result[addr] = resolveCell(addr, []);
  }
  return result;
}

/* ------------------------------ autocomplete ------------------------------- */

export interface FnDoc {
  name: string;
  signature: string;
  doc: string;
  proof?: boolean;
}

export const FORMULA_FUNCTIONS: FnDoc[] = [
  { name: "COUNT_EVENTS", signature: 'COUNT_EVENTS("Zone_A")', doc: "Total completed events in a zone" },
  { name: "AVG_DURATION", signature: 'AVG_DURATION("Zone_A")', doc: "Average event duration, seconds" },
  { name: "MAX_DURATION", signature: 'MAX_DURATION("Zone_A")', doc: "Longest event — click cell for proof", proof: true },
  { name: "MIN_DURATION", signature: 'MIN_DURATION("Zone_A")', doc: "Fastest event — click cell for proof", proof: true },
  { name: "SUM_DURATION", signature: 'SUM_DURATION("Zone_A")', doc: "Total active time in a zone, seconds" },
  { name: "COUNT_OVER", signature: 'COUNT_OVER("Zone_A", 20)', doc: "Events longer than N seconds — click for proof", proof: true },
  { name: "IF", signature: 'IF(B4 > 25, "BOTTLENECK ALERT", "NORMAL")', doc: "Conditional verdict" },
];

/** Suggest completions based on the text before the cursor. */
export function suggestFunctions(before: string): FnDoc[] {
  const m = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
  if (!m) return [];
  const partial = m[1].toUpperCase();
  if (partial.length === 0) return [];
  return FORMULA_FUNCTIONS.filter((f) => f.name.startsWith(partial));
}
