// The **syntax tree** TCQ's parser produces, and the diagnostics it produces alongside
// it.
//
// The tree is deliberately *not* the compiled `GgQuery` contract. Three consumers need
// something the wire form cannot carry:
//
// - the **editor** underlines an error span, so every node keeps the span it came from;
// - the **completer** answers "what can follow the caret" from a half-typed query, so
//   the parser is error-tolerant and every optional part is nullable rather than absent;
// - the **formatter** re-renders the source, so a literal keeps whether it was quoted
//   rather than only what it meant.
//
// Compilation (`compile.ts`) is the one-way step from this tree to the wire form, and it
// is where a relative date becomes absolute milliseconds — which is why a *saved* query
// stores its source text and re-resolves on every run.
import type {
  GgAggFunc,
  GgCompareOp,
  GgIntervalUnit,
} from "@clockwyrks/run-record/gg-query";
import type { Span } from "./lex";

/** A parse problem, with the span the editor should underline. Never fatal: the parser
 *  always returns a tree beside its diagnostics. */
export interface Diagnostic {
  message: string;
  span: Span;
}

/**
 * A reference to a document field.
 *
 * `name` is the resolved dotted name — quoted segments unquoted, parts joined — because
 * that is what the evaluator looks up. `raw` is the source spelling, so the formatter
 * can re-emit `cap."agent-persistence"` rather than inventing its own quoting.
 */
export interface FieldRef {
  name: string;
  raw: string;
  span: Span;
}

/**
 * A literal on the right of an operator, or a bare free-text term.
 *
 * `quoted` is load-bearing rather than cosmetic: an **unquoted** literal is subject to
 * kind inference (`true` is a boolean, `1800` a number, `now-30d` a date), while a
 * quoted one is always the string it spells. That is the only way to ask for the string
 * `"true"` — and, equally, the only way to keep `case:"2026-01-01"` from becoming a
 * timestamp.
 */
export interface LiteralNode {
  /** The literal's text: a string token's contents unescaped, a word token verbatim. */
  raw: string;
  quoted: boolean;
  span: Span;
}

/** The filter half of a query — a predicate tree, which is what lets TCQ express the
 *  "hung or timed out" the all-AND engine it replaced structurally could not. */
export type FilterNode =
  | { kind: "and"; clauses: FilterNode[]; span: Span }
  | { kind: "or"; clauses: FilterNode[]; span: Span }
  | { kind: "not"; clause: FilterNode; span: Span }
  | { kind: "exists"; field: FieldRef; span: Span }
  | {
      kind: "compare";
      field: FieldRef;
      op: GgCompareOp;
      /** The operator as it was spelled, so the formatter round-trips `:` and `=`
       *  distinctly even though both compile to `eq`. */
      opText: string;
      value: LiteralNode | null;
      span: Span;
    }
  | { kind: "oneOf"; field: FieldRef; values: LiteralNode[]; span: Span }
  | {
      kind: "range";
      field: FieldRef;
      from: LiteralNode | null;
      to: LiteralNode | null;
      span: Span;
    }
  | { kind: "text"; value: LiteralNode; span: Span }
  /** A clause the parser could not read. It compiles to nothing — the surrounding query
   *  still runs — which is what keeps a half-typed filter usable for completion. */
  | { kind: "error"; span: Span };

/** One `aggFn(field) as alias` in a `stats` stage. */
export interface AggNode {
  /** `null` when the name is not one of the ten functions — the diagnostic says which. */
  func: GgAggFunc | null;
  /** The function name as written, so the formatter and the editor can show it back. */
  funcText: string;
  field: FieldRef | null;
  alias: string | null;
  span: Span;
}

/** A date-histogram interval, `15m` / `1d` / `2w`. */
export interface IntervalNode {
  count: number;
  unit: GgIntervalUnit;
  raw: string;
  span: Span;
}

/** One group-by key: a plain field, or a field floored onto a fixed-width grid. */
export type GroupNode =
  | { kind: "field"; field: FieldRef; span: Span }
  | {
      kind: "bucket";
      field: FieldRef;
      interval: IntervalNode | null;
      span: Span;
    };

/** One key of an explicit `sort` stage. */
export interface SortKeyNode {
  field: FieldRef;
  desc: boolean;
  span: Span;
}

/** A pipeline stage. `error` is kept in the list so the formatter does not silently
 *  delete text the operator is mid-way through typing. */
export type StageNode =
  | { kind: "stats"; aggs: AggNode[]; groupBy: GroupNode[]; span: Span }
  | { kind: "sort"; keys: SortKeyNode[]; span: Span }
  | { kind: "limit"; value: number | null; span: Span }
  | { kind: "error"; span: Span };

/** A parsed query: a filter (absent for a bare pipeline) and its stages. */
export interface QueryNode {
  filter: FilterNode | null;
  stages: StageNode[];
  span: Span;
}

/** The ten aggregation function names, as the parser matches them. */
export const AGG_FUNCS: readonly GgAggFunc[] = [
  "count",
  "distinct",
  "avg",
  "sum",
  "min",
  "max",
  "median",
  "p90",
  "p95",
  "dist",
];

/** The three stage keywords, as the completer offers them after a `|`. */
export const STAGE_KEYWORDS = ["stats", "sort", "limit"] as const;
