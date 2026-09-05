// Turning a board's panels into **one** batched request.
//
// A dashboard is a page of questions asked over one window, and that shape is what the
// batch endpoint exists for: the panels of a board almost always share a filter and
// differ only in their aggregation, so answering them one request at a time re-resolves
// the same corpus N times — and because the backend's document index refreshes on a
// timer, two panels of the same board can come back from two *different* corpora, which
// reads as a data bug rather than as a stale cache. One batch, one index read, one
// consistent board.
//
// Two things happen to every panel on the way, and both are consequences of the board
// owning the range rather than the panel:
//
// - **The board's range is ANDed onto the panel's own filter**, exactly as Discover ANDs
//   the picker onto the editor's query. The range is resolved against an injected `now`,
//   so the compiled query carries absolute milliseconds and a *saved* board keeps the
//   relative range and re-resolves it every time it is opened.
// - **A date histogram is retuned to the range's interval.** A panel's text carries an
//   explicit `bucket(started, 1d)` because TCQ has no `auto` interval — it has no
//   representation in a compiled query — but a fixed `1d` under a "last 24 hours" board
//   would draw a single point. The picker's presets each carry the interval that lands
//   the range between roughly twenty and a hundred buckets, so the board applies it.
//   Only the *first* group key is retuned: it is the one a line chart binds its x-axis
//   to, and a second bucketed key is a deliberate cross-tabulation whose width the
//   author chose.
import type {
  GgDashboardPanel,
  GgGroupKey,
  GgQuery,
} from "@clockwyrks/run-record/gg-query";
import { compileQuery, parseQuery } from "../query";
import { GG_DATE_FIELDS } from "../query/values";
import { rangeFilter, type TimeRange } from "../discover/TimeRangePicker";

/** One panel, compiled: the wire query plus the parse the panel renders from. */
export interface CompiledPanel {
  /** The panel as stored — its title, source text and grid width. */
  panel: GgDashboardPanel;
  /** The compiled query, board range applied. */
  query: GgQuery;
  /** The stage's group keys after retuning, or `undefined` for a document panel —
   *  what tells the visualization a time series from a bar chart. */
  groupBy?: GgGroupKey[];
  /** The panel's own parse diagnostics, so a board with one broken panel says which
   *  one rather than rendering an empty card. */
  errors: string[];
}

/**
 * Compile every panel of a board into the queries one batch carries, in **render
 * order** — the only binding between a panel and its answer, so the list is never
 * filtered or reordered even when a panel failed to parse.
 *
 * `now` is injected rather than read from the clock so a test can pin it and so the
 * whole board resolves its range against one instant: eight panels each calling
 * `Date.now()` would each get a marginally different window.
 */
export function compilePanels(
  panels: readonly GgDashboardPanel[],
  range: TimeRange,
  now: number,
): CompiledPanel[] {
  const scope = rangeFilter(range, now);
  return panels.map((panel) => {
    const parse = parseQuery(panel.query);
    const compiled = compileQuery(parse.query, { now });
    const query: GgQuery = {
      ...compiled,
      ...(compiled.stats
        ? { stats: { ...compiled.stats, groupBy: retune(compiled.stats.groupBy, range) } }
        : {}),
    };
    if (scope) {
      query.filter = query.filter
        ? { kind: "and", clauses: [scope, query.filter] }
        : scope;
    }
    return {
      panel,
      query,
      groupBy: query.stats?.groupBy,
      errors: parse.diagnostics.map((d) => d.message),
    };
  });
}

/**
 * Retune the first group key to the board range's histogram interval, when it is a
 * date histogram.
 *
 * Scoped to date fields (`started`, `finished`) rather than to any bucketed key: a
 * `bucket(metric.runTimeSeconds, 60)` is a duration histogram whose width has nothing
 * to do with how far back the board looks, and re-tuning it to `1d` would be nonsense.
 */
function retune(
  groupBy: readonly GgGroupKey[] | undefined,
  range: TimeRange,
): GgGroupKey[] | undefined {
  if (!groupBy || groupBy.length === 0) return groupBy as GgGroupKey[] | undefined;
  const [first, ...rest] = groupBy;
  if (!first || first.kind !== "bucket" || !GG_DATE_FIELDS.includes(first.field)) {
    return [...groupBy];
  }
  return [{ ...first, interval: range.interval }, ...rest];
}
