// How a document field or an aggregated figure is **rendered**, and nothing else.
//
// "The engine never formats numbers" is one of TCQ's determinism rules: the evaluator is
// mirrored across Rust and the browser, so any formatting it did would be a place the two
// hosts could publish different strings for the same corpus. Formatting is therefore
// entirely a view concern, and this is the view's half.
//
// The rule that matters most here is the one that keeps a figure honest: **an absent
// value renders as an em dash, never as `0`**. The document builder is careful to leave a
// metric absent rather than zero on a run that produced nothing, precisely so a
// `metric.runTimeSeconds >= 1800` filter does not silently drop the longest runs and an
// average is not dragged toward zero by the runs that burned the most budget. A table
// that printed `0s` for an absent cell would give all of that back.
import type { GgValue } from "@test-cabinet/run-record/gg-query";
import { GG_DATE_FIELDS, asDisplay, formatNumber } from "../query";

/** What a cell shows when the field is **absent from the document**. Distinct from a
 *  stored `0`, which renders as `0`. */
export const ABSENT = "—";

const INTEGER = new Intl.NumberFormat("en-US");
const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * A field's value as a table cell.
 *
 * The formatting is chosen by **field name**, not by value, because a bare number carries
 * no unit: `1800` under `metric.runTimeSeconds` is half an hour and under
 * `metric.totalTokens` it is nothing at all. The rules are deliberately few — a unit for
 * the handful of namespaces that have one, and the value's own rendering otherwise — so a
 * field a feature adds tomorrow is legible without anyone teaching this function about it.
 */
export function formatFieldValue(field: string, value: GgValue | undefined): string {
  if (value === undefined) return ABSENT;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value !== "number") return value;

  if (GG_DATE_FIELDS.includes(field)) return formatTimestamp(value);
  if (field === "score") return value.toFixed(2);
  if (/(^|\.)cost/i.test(field)) return `$${value.toFixed(2)}`;
  if (/runTimeSeconds$/.test(field)) return formatDuration(value);
  if (/tokens$/i.test(field)) return COMPACT.format(value);
  return formatNumber(value);
}

/**
 * An epoch-millisecond timestamp as a UTC minute.
 *
 * Everything about the language is UTC — bucket floors, a bare date's day boundaries, the
 * range picker's `now-30d` — so rendering a local time here would make the table disagree
 * with the query that produced it at exactly the moments (a day boundary) where an
 * operator is most likely to be checking.
 */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) return ABSENT;
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

/** A duration in seconds as `1h 04m`, `12m 30s`, `9s`. Seconds alone below a minute,
 *  because a run that took nine seconds failed and reading `0h 00m 09s` obscures that. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return ABSENT;
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * An aggregated figure as a cell.
 *
 * Given the aggregation's own field where it has one, so `avg(metric.cost)` still reads
 * in dollars — but **never** for `count()` and `distinct()`, whose value is a number of
 * documents no matter what field they counted over.
 */
export function formatAggValue(
  func: string,
  field: string | undefined,
  value: number | undefined,
): string {
  if (value === undefined) return ABSENT;
  if (func === "count" || func === "distinct") return INTEGER.format(value);
  if (!field) return formatNumber(value);
  // Nothing is rounded to a whole number here: an average of a boolean **is** a rate
  // (rule 5), and rounding one to an integer would collapse "a third of these runs
  // overflowed" to "0".
  return formatFieldValue(field, roundForDisplay(field, value));
}

/** A bucket key part, which is an ordinary field value except that a date-histogram key
 *  is a floored bucket start and always reads as a timestamp. */
export function formatBucketKey(
  field: string,
  value: GgValue | undefined,
  isHistogram: boolean,
): string {
  if (value === undefined) return ABSENT;
  if (isHistogram && typeof value === "number") return formatTimestamp(value);
  return formatFieldValue(field, value);
}

/** A value's plain rendering, for a tooltip or a copyable cell title — the same string
 *  the query language itself would compare against. */
export function rawValue(value: GgValue | undefined): string {
  return value === undefined ? ABSENT : asDisplay(value);
}

/** Round a fractional aggregate to something a cell can hold without lying about its
 *  precision. Rates and scores keep two decimals; a duration or a token count is rounded
 *  by its own formatter, so this only has to stop `3.0000000000000004` reaching the DOM. */
function roundForDisplay(field: string, value: number): number {
  if (/runTimeSeconds$/.test(field) || /tokens$/i.test(field)) return value;
  return Math.round(value * 1000) / 1000;
}
