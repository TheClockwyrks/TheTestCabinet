// The **compiler** — the syntax tree to the `GgQuery` wire form.
//
// The client parses the text and sends the compiled query; the URL and the saved object
// carry the **text**. That split is deliberate and it is what makes a relative date
// work: `started >= now-30d` re-resolves every time a saved query runs, while the server
// only ever sees absolute milliseconds and needs no clock of its own. It also means a
// later grammar addition can never invalidate a stored query, because nothing stored is
// in the compiled shape.
//
// Compilation is total: an `error` node compiles to nothing rather than to a failure, so
// a query with one bad clause still runs the clauses that parsed. The caller decides
// whether to run it — `ParseResult.diagnostics` is what the editor underlines.
import type {
  GgAgg,
  GgFilter,
  GgGroupKey,
  GgQuery,
  GgSortKey,
  GgStatsStage,
  GgValue,
} from "@test-cabinet/run-record/gg-query";
import type { FilterNode, LiteralNode, QueryNode } from "./ast";
import { GG_MAX_GROUP_KEYS } from "./values";

/** What compilation needs from the caller that it cannot know itself. */
export interface CompileOptions {
  /**
   * The instant `now` resolves against, in epoch milliseconds. Injected rather than read
   * from the clock so a test — and the conformance-adjacent date cases — can pin it.
   */
  now?: number;
}

/** How long each relative-date suffix is, in milliseconds. Stops at the week for the
 *  same reason a histogram interval does: a month is not a fixed width. */
const RELATIVE_UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * `now`, optionally offset: `now-30d`, `now+1h`.
 *
 * The keyword is case-insensitive; the **unit is not**, for exactly the reason a
 * histogram interval's is not. `M` is a month in most query languages, and under a
 * case-insensitive match of this pattern it would fall through to the `m` alternative
 * and resolve to one *minute* — a factor of forty-three thousand, with no diagnostic,
 * because the literal parsed. The parser rejects the near-miss spellings by name
 * (`Parser.checkRelativeDate`); anything that still reaches here unmatched stays a
 * string.
 */
const RELATIVE_DATE = /^[nN][oO][wW](?:([+-])(\d+)([smhdw]))?$/;

/** A bare calendar day, `2026-01-01`. Deliberately **day resolution only**: `:` is the
 *  equality operator, so a full ISO timestamp cannot lex as one bare word. Anything
 *  finer is written as epoch milliseconds — which is what the compiled form carries
 *  anyway — or comes from the time-range picker. */
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The number spellings the compiler reads as numbers. Matches Rust's float grammar
 *  rather than JavaScript's `Number`, which would also swallow `0x10` and `""`. */
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** The last millisecond of a day — what a bare date means as an **inclusive upper
 *  bound**, so `[2026-01-01 to 2026-01-31]` is a whole month rather than a month minus
 *  its last day. */
const DAY_MS = 86_400_000;

/** Where a literal sits, which is the only thing that changes how a bare date resolves. */
type LiteralPosition = "value" | "upperBound";

/** Compile a parsed query into the wire form. */
export function compileQuery(query: QueryNode, options: CompileOptions = {}): GgQuery {
  const now = options.now ?? Date.now();
  const compiled: GgQuery = {};

  const filter = query.filter ? compileFilter(query.filter, now) : null;
  if (filter) compiled.filter = filter;

  for (const stage of query.stages) {
    if (stage.kind === "stats") {
      const aggs: GgAgg[] = [];
      for (const agg of stage.aggs) {
        if (!agg.func) continue;
        if (agg.func !== "count" && !agg.field) continue;
        const one: GgAgg = { func: agg.func };
        if (agg.func !== "count" && agg.field) one.field = agg.field.name;
        if (agg.alias) one.alias = agg.alias;
        aggs.push(one);
      }
      const groupBy: GgGroupKey[] = [];
      for (const group of stage.groupBy.slice(0, GG_MAX_GROUP_KEYS)) {
        if (group.kind === "field") {
          groupBy.push({ kind: "field", field: group.field.name });
        } else if (group.interval) {
          groupBy.push({
            kind: "bucket",
            field: group.field.name,
            interval: { count: group.interval.count, unit: group.interval.unit },
          });
        }
      }
      const stats: GgStatsStage = { aggs };
      if (groupBy.length > 0) stats.groupBy = groupBy;
      compiled.stats = stats;
    } else if (stage.kind === "sort") {
      const sort: GgSortKey[] = stage.keys.map((key) => ({
        field: key.field.name,
        desc: key.desc,
      }));
      if (sort.length > 0) compiled.sort = sort;
    } else if (stage.kind === "limit" && stage.value !== null) {
      compiled.limit = stage.value;
    }
  }

  return compiled;
}

/**
 * Compile a filter subtree, dropping unreadable clauses.
 *
 * Dropping rather than failing is what keeps a half-typed query running: an `and` whose
 * third clause is mid-edit still filters on the first two, so the result list moves as
 * the operator types instead of blanking. Returns `null` when nothing survived, which
 * the caller reads as "no filter" — the same as an empty query.
 */
function compileFilter(node: FilterNode, now: number): GgFilter | null {
  switch (node.kind) {
    case "and":
    case "or": {
      const clauses = node.clauses
        .map((clause) => compileFilter(clause, now))
        .filter((clause): clause is GgFilter => clause !== null);
      if (clauses.length === 0) return null;
      if (clauses.length === 1) return clauses[0]!;
      return { kind: node.kind, clauses };
    }
    case "not": {
      const clause = compileFilter(node.clause, now);
      return clause ? { kind: "not", clause } : null;
    }
    case "exists":
      return { kind: "exists", field: node.field.name };
    case "compare": {
      if (!node.value) return null;
      const upper = node.op === "lte";
      return {
        kind: "compare",
        field: node.field.name,
        op: node.op,
        value: literalValue(node.value, now, upper ? "upperBound" : "value"),
      };
    }
    case "oneOf": {
      if (node.values.length === 0) return null;
      return {
        kind: "oneOf",
        field: node.field.name,
        values: node.values.map((value) => literalValue(value, now, "value")),
      };
    }
    case "range": {
      const range: Extract<GgFilter, { kind: "range" }> = {
        kind: "range",
        field: node.field.name,
      };
      if (node.from) range.from = literalValue(node.from, now, "value");
      // Only the *upper* bound stretches a bare date to the end of its day: the lower
      // bound already means "from the start of that day", so widening it would silently
      // exclude the day the operator asked for.
      if (node.to) range.to = literalValue(node.to, now, "upperBound");
      if (range.from === undefined && range.to === undefined) return null;
      return range;
    }
    case "text":
      return { kind: "text", text: node.value.raw };
    case "error":
      return null;
  }
}

/**
 * Read a literal as a typed value.
 *
 * A **quoted** literal is always the string it spells — that is the only way to ask for
 * the string `"true"`, and equally the only way to stop `case:"2026-01-01"` from
 * becoming a timestamp. An unquoted one is inferred, in this order: boolean, number,
 * date, string.
 *
 * Date inference is unconditional rather than gated on the field being a known date
 * field. `now-30d` and `2026-01-01` have no other plausible reading in this corpus, and
 * gating on the field would make the same literal mean different things depending on
 * whether the field sidebar had loaded yet — which is the sort of thing that turns a
 * saved dashboard into a support question.
 */
export function literalValue(
  literal: LiteralNode,
  now: number,
  position: LiteralPosition = "value",
): GgValue {
  if (literal.quoted) return literal.raw;
  const raw = literal.raw;

  const lowered = raw.toLowerCase();
  if (lowered === "true") return true;
  if (lowered === "false") return false;

  if (NUMBER.test(raw)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }

  const relative = RELATIVE_DATE.exec(raw);
  if (relative) {
    if (!relative[1]) return now;
    const magnitude = Number(relative[2]) * RELATIVE_UNITS[relative[3]!]!;
    return relative[1] === "-" ? now - magnitude : now + magnitude;
  }

  const day = CALENDAR_DAY.exec(raw);
  if (day) {
    const start = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    if (!Number.isNaN(start)) {
      return position === "upperBound" ? start + DAY_MS - 1 : start;
    }
  }

  return raw;
}
