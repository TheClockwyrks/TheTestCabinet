// The **parser** — a hand-written recursive descent over the token stream, producing the
// tree in `ast.ts` plus a list of diagnostics.
//
// The grammar it implements, verbatim from the design doc and **frozen for v1**:
//
// ```text
// query        ::= filter ( "|" stage )*
// filter       ::= orExpr | ε
// orExpr       ::= andExpr ( "or" andExpr )*
// andExpr      ::= unary ( "and"? unary )*          (* juxtaposition = AND *)
// unary        ::= ("not" | "-") unary | primary
// primary      ::= "(" orExpr ")" | predicate
//
// predicate    ::= field ":" "*"                             (* exists  *)
//                | field ":" "(" literal ("or" literal)* ")" (* one-of  *)
//                | field ":" "[" bound "to" bound "]"        (* range   *)
//                | field op literal                          (* compare *)
//                | literal                                   (* free text *)
// op           ::= ":" | "!=" | ">=" | "<=" | ">" | "<"
//
// stage        ::= "stats" aggList ("by" groupList)? | "sort" sortList | "limit" INT
// agg          ::= aggFn "(" field? ")" ("as" IDENT)?
// group        ::= field | "bucket" "(" field "," interval ")"
// ```
//
// **It never throws and never gives up.** Live validation runs on every keystroke, so
// the normal input is a half-typed query: an unreadable clause becomes an `error` node
// with a span, the parser resynchronises, and the partial tree still drives completion
// and highlighting. A parser that bailed on the first bad token would blank the field
// sidebar exactly when the operator most needs it.
import type { GgAggFunc, GgCompareOp, GgIntervalUnit } from "@test-cabinet/run-record/gg-query";
import {
  AGG_FUNCS,
  type AggNode,
  type Diagnostic,
  type FieldRef,
  type FilterNode,
  type GroupNode,
  type IntervalNode,
  type LiteralNode,
  type QueryNode,
  type SortKeyNode,
  type StageNode,
} from "./ast";
import { type Span, type Token, isKeyword, keywordOf, tokenize } from "./lex";
import { GG_MAX_GROUP_KEYS } from "./values";

/** Everything one parse produced: the tree, what went wrong, and the tokens — which the
 *  editor's highlight layer and the completer both read rather than re-lexing. */
export interface ParseResult {
  text: string;
  tokens: Token[];
  query: QueryNode;
  diagnostics: Diagnostic[];
}

/** The `:` and `!=`-family spellings, mapped to the compiled operator. */
const COMPARE_OPS: Record<string, GgCompareOp> = {
  ":": "eq",
  "!=": "ne",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
};

/** A bare word that *opens* like a relative date, valid or not — the only words
 *  {@link Parser.checkRelativeDate} inspects. */
const RELATIVE_DATE_OPENER = /^[nN][oO][wW][+-]/;

/** The offsets the compiler resolves, in the spelling it resolves them in. Kept in step
 *  with `RELATIVE_DATE` in `compile.ts`; case-**sensitive** on the unit, so `now-1M` is
 *  a diagnostic here rather than one minute there. */
const RELATIVE_DATE = /^[nN][oO][wW][+-]\d+[smhdw]$/;

/** The interval suffixes, mapped to the compiled unit. Deliberately stops at the week:
 *  a month is not a fixed number of milliseconds, so bucketing by one would need a civil
 *  calendar in **both** implementations. */
const INTERVAL_UNITS: Record<string, GgIntervalUnit> = {
  m: "minute",
  h: "hour",
  d: "day",
  w: "week",
};

/** Parse `text`. Always succeeds; read `diagnostics` for what it could not make sense
 *  of. */
export function parseQuery(text: string): ParseResult {
  return new Parser(text).parse();
}

class Parser {
  private readonly tokens: Token[];
  private readonly diagnostics: Diagnostic[] = [];
  private at = 0;

  constructor(private readonly text: string) {
    this.tokens = tokenize(text);
  }

  parse(): ParseResult {
    for (const token of this.tokens) {
      if (token.kind === "error") {
        this.error(token, `Unexpected character ${JSON.stringify(token.text)}`);
      } else if (token.kind === "string" && token.unterminated) {
        this.error(token, "Unterminated string — add a closing quote");
      }
    }

    const filter = this.peek().kind === "pipe" ? null : this.parseFilter();
    const stages: StageNode[] = [];
    while (this.peek().kind === "pipe") {
      this.next();
      stages.push(this.parseStage());
    }
    if (this.peek().kind !== "eof") {
      const stray = this.peek();
      // A lexer `error` token was already reported by the scan above; a second
      // diagnostic on the same character would double-underline it.
      if (stray.kind !== "error") {
        this.error(stray, `Unexpected ${JSON.stringify(stray.text)}`);
      }
      // Consume the rest so the loop terminates; the tree keeps what parsed.
      while (this.peek().kind !== "eof") this.next();
    }

    return {
      text: this.text,
      tokens: this.tokens,
      query: {
        filter,
        stages,
        span: { start: 0, end: this.text.length },
      },
      diagnostics: this.diagnostics,
    };
  }

  // --- token plumbing ---------------------------------------------------------

  private peek(offset = 0): Token {
    // The token list always ends with `eof`, so a clamped index is always in range.
    return this.tokens[Math.min(this.at + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const token = this.peek();
    if (this.at < this.tokens.length - 1) this.at += 1;
    return token;
  }

  private error(at: Token | Span, message: string): void {
    const span = "kind" in at ? { start: at.start, end: at.end } : at;
    this.diagnostics.push({ message, span });
  }

  private span(start: number): Span {
    return { start, end: this.tokens[Math.max(0, this.at - 1)]!.end };
  }

  // --- the filter -------------------------------------------------------------

  /** `orExpr ::= andExpr ("or" andExpr)*`. */
  private parseFilter(): FilterNode | null {
    if (this.atFilterEnd()) return null;
    const start = this.peek().start;
    const first = this.parseAnd();
    const clauses = [first];
    while (isKeyword(this.peek(), "or")) {
      this.next();
      clauses.push(this.parseAnd());
    }
    if (clauses.length === 1) return first;
    return { kind: "or", clauses, span: this.span(start) };
  }

  /** `andExpr ::= unary ("and"? unary)*` — juxtaposition is AND, which is what makes a
   *  query bar feel like a search box rather than a form. */
  private parseAnd(): FilterNode {
    const start = this.peek().start;
    const clauses = [this.parseUnary()];
    for (;;) {
      if (isKeyword(this.peek(), "and")) {
        this.next();
        clauses.push(this.parseUnary());
        continue;
      }
      if (this.startsUnary()) {
        clauses.push(this.parseUnary());
        continue;
      }
      break;
    }
    if (clauses.length === 1) return clauses[0]!;
    return { kind: "and", clauses, span: this.span(start) };
  }

  /** `unary ::= ("not" | "-") unary | primary`. */
  private parseUnary(): FilterNode {
    const start = this.peek().start;
    if (isKeyword(this.peek(), "not") || this.peek().kind === "minus") {
      this.next();
      const clause = this.parseUnary();
      return { kind: "not", clause, span: this.span(start) };
    }
    return this.parsePrimary();
  }

  /** `primary ::= "(" orExpr ")" | predicate`. */
  private parsePrimary(): FilterNode {
    const start = this.peek().start;
    if (this.peek().kind === "lparen") {
      this.next();
      const inner = this.parseFilter();
      if (this.peek().kind === "rparen") this.next();
      else this.error(this.peek(), "Expected `)`");
      if (inner) return inner;
      this.error(this.span(start), "Empty group");
      return { kind: "error", span: this.span(start) };
    }
    return this.parsePredicate();
  }

  /** One predicate, or an `error` node when the tokens make no predicate at all. */
  private parsePredicate(): FilterNode {
    const start = this.peek().start;
    const head = this.peek();
    const field = this.parseFieldRef();
    if (!field) {
      // A lexer `error` token already carries its own diagnostic; a second one pointing
      // at the same character is noise.
      if (head.kind !== "error") {
        this.error(head, `Expected a field or a search term, found ${describe(head)}`);
      }
      // Always consume something, or an unreadable token spins the AND loop forever.
      this.next();
      return { kind: "error", span: this.span(start) };
    }

    const op = this.peek();
    if (op.kind === "colon") {
      this.next();
      return this.parseColonPredicate(field, start);
    }
    if (op.kind === "op") {
      this.next();
      const value = this.parseLiteral();
      if (!value) this.error(this.peek(), `Expected a value after \`${op.text}\``);
      return {
        kind: "compare",
        field,
        op: COMPARE_OPS[op.text]!,
        opText: op.text,
        value,
        span: this.span(start),
      };
    }

    // No operator followed, so the thing that looked like a field was a bare term.
    return {
      kind: "text",
      value: { raw: field.name, quoted: field.raw.startsWith('"'), span: field.span },
      span: field.span,
    };
  }

  /** The four shapes `:` introduces: exists, one-of, range, and plain equality. */
  private parseColonPredicate(field: FieldRef, start: number): FilterNode {
    const token = this.peek();

    if (token.kind === "word" && token.text === "*") {
      this.next();
      return { kind: "exists", field, span: this.span(start) };
    }

    if (token.kind === "lparen") {
      this.next();
      const values: LiteralNode[] = [];
      for (;;) {
        if (this.peek().kind === "rparen" || this.peek().kind === "eof") break;
        const value = this.parseLiteral();
        if (!value) {
          this.error(this.peek(), "Expected a value inside `(...)`");
          this.next();
          continue;
        }
        values.push(value);
        if (isKeyword(this.peek(), "or")) {
          this.next();
        } else if (this.peek().kind !== "rparen" && this.peek().kind !== "eof") {
          // Keep going anyway — a missing separator is a typo mid-edit, and dropping the
          // rest of the list would blank the result the operator is looking at.
          this.error(this.peek(), "Expected `or` between values, or `)`");
        }
      }
      if (this.peek().kind === "rparen") this.next();
      else this.error(this.peek(), "Expected `)`");
      if (values.length === 0) this.error(this.span(start), "An empty `(...)` matches nothing");
      return { kind: "oneOf", field, values, span: this.span(start) };
    }

    if (token.kind === "lbracket") {
      this.next();
      const from = this.parseBound();
      if (isKeyword(this.peek(), "to")) this.next();
      else this.error(this.peek(), "Expected `to` between the range bounds");
      const to = this.parseBound();
      if (this.peek().kind === "rbracket") this.next();
      else this.error(this.peek(), "Expected `]`");
      return { kind: "range", field, from, to, span: this.span(start) };
    }

    const value = this.parseLiteral();
    if (!value) this.error(this.peek(), "Expected a value after `:`");
    return {
      kind: "compare",
      field,
      op: "eq",
      opText: ":",
      value,
      span: this.span(start),
    };
  }

  /** One end of a range. A bare `*` is an **open** bound, which is how a half-open range
   *  is written without a second syntax for it. */
  private parseBound(): LiteralNode | null {
    const token = this.peek();
    if (token.kind === "word" && token.text === "*") {
      this.next();
      return null;
    }
    const value = this.parseLiteral();
    if (!value) this.error(this.peek(), "Expected a range bound (a value or `*`)");
    return value;
  }

  /**
   * A dotted field name, whose segments may be quoted individually
   * (`cap."speculative-execution"`).
   *
   * Segments are glued only when they are **adjacent in the source** — the next token
   * starts exactly where the last one ended — so `case: carom` never reads as a field
   * called `case:carom`, and a space is always a separator.
   */
  private parseFieldRef(): FieldRef | null {
    const first = this.peek();
    if (first.kind !== "word" && first.kind !== "string") return null;
    this.next();
    let name = first.kind === "string" ? first.value : first.text;
    let raw = first.text;
    const start = first.start;
    let end = first.end;
    for (;;) {
      const token = this.peek();
      const adjacent = token.start === end;
      const joins =
        (token.kind === "string" && name.endsWith(".")) ||
        (token.kind === "word" && token.text.startsWith("."));
      if (!adjacent || !joins) break;
      this.next();
      name += token.kind === "string" ? token.value : token.text;
      raw += token.text;
      end = token.end;
    }
    return { name, raw, span: { start, end } };
  }

  /** A literal value: a quoted string, or a bare word the compiler will read as a
   *  boolean, a number, a date or a string. */
  private parseLiteral(): LiteralNode | null {
    const token = this.peek();
    if (token.kind === "string") {
      this.next();
      return { raw: token.value, quoted: true, span: { start: token.start, end: token.end } };
    }
    if (token.kind === "word") {
      this.next();
      this.checkRelativeDate(token);
      return { raw: token.text, quoted: false, span: { start: token.start, end: token.end } };
    }
    return null;
  }

  /**
   * Report a mis-spelled relative date instead of letting it fall through to a string.
   *
   * `now-1M` is the spelling worth catching, and it is the sibling of the `1M` histogram
   * interval this parser already rejects. Both failure modes are silent: a
   * case-insensitive unit resolves it to one *minute*, answering "the last sixty
   * seconds" to a question about the last month; and a compiler that instead left it as
   * the bare string `now-1M` would compare a timestamp against a word and quietly match
   * nothing. So the near-misses are named here, where there is a diagnostic channel —
   * the compiler has none, being total by construction.
   *
   * Only words that already *open* like an offset are checked, so an ordinary search
   * term is never second-guessed.
   */
  private checkRelativeDate(token: Token): void {
    if (!RELATIVE_DATE_OPENER.test(token.text)) return;
    if (RELATIVE_DATE.test(token.text)) return;
    this.error(
      token,
      `\`${token.text}\` is not a relative date — use e.g. \`now-30d\`, \`now-1h\`, \`now+15m\`. A month is not a fixed width, so there is no \`M\``,
    );
  }

  /**
   * Whether the next token could begin another juxtaposed clause.
   *
   * A keyword stops the chain, or `stats count() by preset` would read `by` as a search
   * term — **unless it is being used as a field**, which the following token settles.
   * That exception is not hypothetical: `limit` is a stage keyword *and* a real document
   * field (the execution ceiling a run breached), so `state:completed limit:none` has to
   * keep going.
   */
  private startsUnary(): boolean {
    const token = this.peek();
    if (token.kind === "minus" || token.kind === "lparen") return true;
    if (token.kind === "string") return true;
    if (token.kind !== "word") return false;
    const keyword = keywordOf(token);
    if (keyword === null || keyword === "not") return true;
    const after = this.peek(1);
    return after.kind === "colon" || after.kind === "op";
  }

  /** Whether the parser has reached something that cannot be part of a filter. */
  private atFilterEnd(): boolean {
    const kind = this.peek().kind;
    return kind === "eof" || kind === "pipe" || kind === "rparen";
  }

  // --- the stages -------------------------------------------------------------

  private parseStage(): StageNode {
    const start = this.peek().start;
    const head = this.peek();
    if (isKeyword(head, "stats")) {
      this.next();
      return this.parseStats(start);
    }
    if (isKeyword(head, "sort")) {
      this.next();
      return this.parseSort(start);
    }
    if (isKeyword(head, "limit")) {
      this.next();
      return this.parseLimit(start);
    }
    this.error(head, "Expected `stats`, `sort` or `limit` after `|`");
    while (this.peek().kind !== "eof" && this.peek().kind !== "pipe") this.next();
    return { kind: "error", span: this.span(start) };
  }

  /** `stats aggList ("by" groupList)?`. */
  private parseStats(start: number): StageNode {
    const aggs: AggNode[] = [];
    for (;;) {
      const agg = this.parseAgg();
      if (agg) aggs.push(agg);
      if (this.peek().kind === "comma") {
        this.next();
        continue;
      }
      break;
    }
    if (aggs.length === 0) {
      this.error(this.span(start), "`stats` needs at least one aggregation, e.g. `count()`");
    }

    const groupBy: GroupNode[] = [];
    if (isKeyword(this.peek(), "by")) {
      this.next();
      for (;;) {
        const group = this.parseGroup();
        if (group) groupBy.push(group);
        if (this.peek().kind === "comma") {
          this.next();
          continue;
        }
        break;
      }
      if (groupBy.length === 0) this.error(this.peek(), "Expected a field after `by`");
      if (groupBy.length > GG_MAX_GROUP_KEYS) {
        // Rejected rather than clamped silently: bucket cardinality is the *product* of
        // the keys' cardinalities, and a fourth key that vanished without a word would
        // read as the evaluator losing data.
        const extra = groupBy[GG_MAX_GROUP_KEYS]!;
        const last = groupBy[groupBy.length - 1]!;
        this.error(
          { start: extra.span.start, end: last.span.end },
          `At most ${GG_MAX_GROUP_KEYS} group-by keys — a visualization binds the first two and a table the third`,
        );
      }
    }

    return { kind: "stats", aggs, groupBy, span: this.span(start) };
  }

  /** `aggFn "(" field? ")" ("as" IDENT)?`. */
  private parseAgg(): AggNode | null {
    const start = this.peek().start;
    const head = this.peek();
    if (head.kind !== "word") {
      this.error(head, `Expected an aggregation, found ${describe(head)}`);
      return null;
    }
    this.next();
    const funcText = head.text;
    const lowered = funcText.toLowerCase() as GgAggFunc;
    const func = AGG_FUNCS.includes(lowered) ? lowered : null;
    if (!func) {
      this.error(head, `Unknown aggregation \`${funcText}\` — one of ${AGG_FUNCS.join(", ")}`);
    }

    let field: FieldRef | null = null;
    if (this.peek().kind === "lparen") {
      this.next();
      if (this.peek().kind !== "rparen") field = this.parseFieldRef();
      if (this.peek().kind === "rparen") this.next();
      else this.error(this.peek(), "Expected `)`");
    } else {
      this.error(this.peek(), `Expected \`(\` after \`${funcText}\``);
    }

    if (func && func !== "count" && !field) {
      this.error(this.span(start), `\`${func}\` needs a field, e.g. \`${func}(score)\``);
    }
    if (func === "count" && field) {
      // Harmless rather than wrong: `count()` aggregates the documents themselves, so a
      // field cannot change the answer. Dropped here so the compiled query is canonical.
      field = null;
    }

    let alias: string | null = null;
    if (isKeyword(this.peek(), "as")) {
      this.next();
      const name = this.peek();
      if (name.kind === "word" || name.kind === "string") {
        this.next();
        alias = name.kind === "string" ? name.value : name.text;
      } else {
        this.error(name, "Expected a column name after `as`");
      }
    }

    return { func, funcText, field, alias, span: this.span(start) };
  }

  /** `field | "bucket" "(" field "," interval ")"`. */
  private parseGroup(): GroupNode | null {
    const start = this.peek().start;
    if (isKeyword(this.peek(), "bucket") && this.peek(1).kind === "lparen") {
      this.next();
      this.next();
      const field = this.parseFieldRef();
      if (!field) {
        this.error(this.peek(), "Expected a field inside `bucket(...)`");
        return null;
      }
      let interval: IntervalNode | null = null;
      if (this.peek().kind === "comma") {
        this.next();
        interval = this.parseInterval();
      } else {
        this.error(this.peek(), "Expected `,` and an interval, e.g. `bucket(started, 1d)`");
      }
      if (this.peek().kind === "rparen") this.next();
      else this.error(this.peek(), "Expected `)`");
      return { kind: "bucket", field, interval, span: this.span(start) };
    }

    const field = this.parseFieldRef();
    if (!field) {
      this.error(this.peek(), `Expected a field to group by, found ${describe(this.peek())}`);
      return null;
    }
    return { kind: "field", field, span: this.span(start) };
  }

  /** `15m`, `1d`, `2w` — a count and a unit, with no `auto`: it has no representation in
   *  a compiled query and is genuinely unresolvable for a query with no time bound, so
   *  the time-range presets carry explicit intervals instead. */
  private parseInterval(): IntervalNode | null {
    const token = this.peek();
    if (token.kind !== "word") {
      this.error(token, "Expected an interval like `1d`, `15m` or `1w`");
      return null;
    }
    // Case-**sensitive**, and deliberately so: `1M` means one month in most query
    // languages and one minute under a case-insensitive match of this pattern. Silently
    // reading it as a minute would be a factor of forty-three thousand, so it is rejected
    // and the message names the spellings that work.
    const match = /^(\d+)([mhdw])$/.exec(token.text);
    if (!match) {
      this.error(token, `\`${token.text}\` is not an interval — use e.g. \`15m\`, \`1h\`, \`1d\`, \`1w\``);
      this.next();
      return null;
    }
    this.next();
    const count = Number(match[1]);
    if (count <= 0) {
      this.error(token, "An interval must be at least one unit wide");
    }
    return {
      count: Math.max(1, count),
      unit: INTERVAL_UNITS[match[2]!]!,
      raw: token.text,
      span: { start: token.start, end: token.end },
    };
  }

  /** `sort field [asc|desc] (, field [asc|desc])*`. */
  private parseSort(start: number): StageNode {
    const keys: SortKeyNode[] = [];
    for (;;) {
      const keyStart = this.peek().start;
      const field = this.parseFieldRef();
      if (!field) {
        this.error(this.peek(), "Expected a field to sort by");
        break;
      }
      let desc = false;
      if (isKeyword(this.peek(), "desc")) {
        this.next();
        desc = true;
      } else if (isKeyword(this.peek(), "asc")) {
        this.next();
      }
      keys.push({ field, desc, span: this.span(keyStart) });
      if (this.peek().kind === "comma") {
        this.next();
        continue;
      }
      break;
    }
    return { kind: "sort", keys, span: this.span(start) };
  }

  /** `limit INT`. */
  private parseLimit(start: number): StageNode {
    const token = this.peek();
    if (token.kind !== "word" || !/^\d+$/.test(token.text)) {
      this.error(token, "Expected a whole number after `limit`");
      return { kind: "limit", value: null, span: this.span(start) };
    }
    this.next();
    return { kind: "limit", value: Number(token.text), span: this.span(start) };
  }
}

/** How a token reads inside a diagnostic. */
function describe(token: Token): string {
  return token.kind === "eof" ? "the end of the query" : JSON.stringify(token.text);
}
