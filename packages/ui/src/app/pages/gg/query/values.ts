// The **value semantics** of TCQ — the TypeScript twin of the behaviour that lives on
// `GgValue`, `GgInterval` and `GgAgg` in `crates/core/src/gg_query.rs`.
//
// Everything here is mirrored: the console evaluates a query on the backend (Rust) and
// the public static site evaluates the *same* query in the browser (this file), so a
// disagreement between the two publishes different numbers for the same corpus. Rust is
// the reference implementation; where the two languages differ by default — string
// ordering above all — this file is the one that has to bend.
//
// The shared `gg_query.conformance.json` fixture beside the Rust test is what holds the
// pair together. A change to any rule here must arrive with a fixture case that would
// have caught the drift.
import type {
  GgAgg,
  GgAggFunc,
  GgInterval,
  GgValue,
} from "@clockwyrks/run-record/gg-query";

/**
 * The most group-by keys one `stats` stage may carry. Visualizations bind the first
 * two; a third is table-only, and beyond that a bucket table is unreadable and the
 * cardinality explodes (it is the product of the keys' cardinalities). The compiler
 * rejects a longer list at parse time; the evaluator clamps to the same bound so a
 * hand-built query cannot get further. Mirrors `GG_MAX_GROUP_KEYS`.
 */
export const GG_MAX_GROUP_KEYS = 3;

/**
 * How many distinct values `fieldCatalog` reports per field — the click-to-insert
 * value suggestions the sidebar and the completer offer, with their counts. A
 * *starting point*, not an enumeration: a high-cardinality field (a run id, a
 * timestamp) is not meant to be browsed value by value. Mirrors
 * `GG_FIELD_TOP_VALUES`.
 */
export const GG_FIELD_TOP_VALUES = 10;

/**
 * The floor origin for a `week` interval: `1969-12-29T00:00:00Z`, the **Monday**
 * before the epoch.
 *
 * The Unix epoch was a Thursday, so flooring weeks against it produces
 * Thursday-to-Wednesday buckets, which every reader reports as a bug. Both
 * implementations must use this constant; it is pinned by a conformance case.
 * Mirrors `WEEK_ORIGIN_MS`.
 */
export const WEEK_ORIGIN_MS = -259_200_000;

/**
 * The fields that are epoch-millisecond timestamps rather than plain numbers.
 *
 * Rule 6 makes a date *be* a number, which is what keeps ranges, sorts and histograms
 * out of the evaluator entirely — but it also means date-ness cannot be observed from
 * the values. This list is how the field catalog still labels them `date`, so the
 * editor offers a date picker and a histogram interval instead of a raw number box.
 * Mirrors `GG_DATE_FIELDS`.
 */
export const GG_DATE_FIELDS: readonly string[] = ["started", "finished"];

/**
 * This value's numeric projection, or `undefined` when it has none: a boolean is
 * `1`/`0` (rule 5, which is what makes averaging one a rate), a finite number is
 * itself, and a string has no numeric meaning even when it happens to look like one —
 * a field's kind is a property of the corpus, not of one value's spelling.
 *
 * A non-finite number also answers `undefined`. Rule 7 keeps those out of a document
 * in the first place; this is the second line of defence for a document that arrived
 * from somewhere else. Mirrors `GgValue::as_number`.
 */
export function asNumber(value: GgValue): number | undefined {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  return undefined;
}

/**
 * Render a number the way both implementations must: an integral value with no
 * fractional part (`1`, not `1.0`), everything else through the shortest
 * round-tripping form.
 *
 * Rust's `Display` for `f64` and JavaScript's `Number.prototype.toString` agree over
 * the range a document carries; they diverge only at magnitudes where JavaScript
 * switches to exponent notation (`1e21` and above, `1e-7` and below) and Rust does
 * not. Nothing a run document holds — a timestamp, a token count, a cost, a fraction
 * — comes near either boundary, and the alternative is reimplementing Rust's float
 * formatter in the browser. Mirrors `format_number`.
 */
export function formatNumber(n: number): string {
  if (Number.isFinite(n) && Number.isInteger(n) && Math.abs(n) < 1e15) {
    // `-0` renders as `0`, matching Rust's `n as i64` cast.
    return String(n === 0 ? 0 : n);
  }
  return String(n);
}

/**
 * This value's string rendering, used when a comparison crosses kinds and when a
 * free-text term is matched. Mirrors `GgValue::as_display`.
 */
export function asDisplay(value: GgValue): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return formatNumber(value);
  return value;
}

/**
 * The kind rank behind {@link totalCompare}: booleans before numbers before strings.
 *
 * Any fixed order works — what matters is that both implementations pick the *same*
 * one, so a group-by over a field whose values are of mixed kinds (a corpus spanning a
 * rename or a type change) buckets identically on the console and on the public site.
 * Mirrors `GgValue::kind_rank`.
 */
function kindRank(value: GgValue): number {
  if (typeof value === "boolean") return 0;
  if (typeof value === "number") return 1;
  return 2;
}

/**
 * Compare two strings **by Unicode code point** — the single place where the
 * TypeScript twin cannot use the language's own operators.
 *
 * Rust orders strings by UTF-8 bytes, which *is* code-point order. JavaScript's `<`,
 * `>` and `sort()` order by UTF-16 code unit, and `localeCompare` orders by collation;
 * both disagree with code-point order above the BMP, because an astral character is a
 * surrogate pair beginning at U+D800 while U+E000..U+FFFF sit above it. So `"！"`
 * (U+FF01) sorts *before* `"😀"` (U+1F600) here and *after* it under `<`.
 *
 * Walks code points in place rather than materialising `Array.from` arrays, because
 * this runs inside every bucket-key comparison of every fold.
 */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i) as number;
    const cb = b.codePointAt(j) as number;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  // One ran out first: a prefix sorts before what extends it, which is also what
  // comparing UTF-8 byte slices of different lengths does.
  if (i >= a.length && j >= b.length) return 0;
  return i >= a.length ? -1 : 1;
}

/**
 * Compare two numbers under Rust's `f64::total_cmp`: `-0` before `+0`, and a `NaN`
 * outside every finite value so the order stays transitive.
 *
 * A document never carries a `NaN` — rule 7 drops one at build time and JSON cannot
 * encode one — so the `NaN` arms exist only so a hand-built corpus cannot make a sort
 * intransitive. `f64::total_cmp` distinguishes the two `NaN` signs; JavaScript cannot
 * observe a `NaN`'s sign without bit inspection, and since no representable document
 * can hold one the distinction is unreachable.
 */
export function compareNumbers(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  const nanA = Number.isNaN(a);
  const nanB = Number.isNaN(b);
  if (nanA || nanB) return nanA && nanB ? 0 : nanA ? 1 : -1;
  const negZeroA = Object.is(a, -0);
  const negZeroB = Object.is(b, -0);
  if (negZeroA === negZeroB) return 0;
  return negZeroA ? -1 : 1;
}

/**
 * The **total order** over values — the one order bucket keys, distinct counts, sort
 * tiebreaks and the catalog's top-value ties all use.
 *
 * Across kinds it is the fixed {@link kindRank}; within a kind it is `false` before
 * `true`, {@link compareNumbers}, and {@link compareCodePoints}. Using one order
 * everywhere is what stops "group by model" and "how many models?" from ever
 * disagreeing about whether two values are the same one. Mirrors
 * `GgValue::total_cmp`.
 */
export function totalCompare(a: GgValue, b: GgValue): number {
  const ra = kindRank(a);
  const rb = kindRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a === b ? 0 : a ? 1 : -1;
  }
  if (typeof a === "number" && typeof b === "number") {
    return compareNumbers(a, b);
  }
  return compareCodePoints(a as string, b as string);
}

/**
 * A string key that identifies a value under {@link totalCompare} — the stand-in for
 * Rust's `BTreeMap<OrdValue, _>` when grouping, counting distinct values or tallying
 * the catalog's top values.
 *
 * A plain `Map` keyed on the value itself would be wrong twice over: it would fold
 * `-0` and `0` together (`SameValueZero`, where the total order separates them), and
 * it could never distinguish `true` from `"true"` in a display sense. Encoding the
 * kind rank into the key keeps the two implementations counting the same buckets.
 */
export function valueKey(value: GgValue): string {
  if (typeof value === "boolean") return value ? "0:t" : "0:f";
  if (typeof value === "number") {
    return `1:${Object.is(value, -0) ? "-0" : String(value)}`;
  }
  return `2:${value}`;
}

/**
 * This interval's width in milliseconds (at least one unit — a zero count is treated
 * as one rather than dividing by zero on a hand-built query). Mirrors
 * `GgInterval::millis`.
 */
export function intervalMillis(interval: GgInterval): number {
  const unit =
    interval.unit === "minute"
      ? 60_000
      : interval.unit === "hour"
        ? 3_600_000
        : interval.unit === "day"
          ? 86_400_000
          : 604_800_000;
  return unit * Math.max(1, interval.count);
}

/**
 * Floor an epoch-millisecond timestamp onto this interval's grid.
 *
 * Minute, hour and day intervals floor against the epoch; a **week floors against
 * {@link WEEK_ORIGIN_MS}**, the Monday before it. `Math.floor` (not truncating
 * division) so a pre-epoch timestamp lands in the bucket that *contains* it — the week
 * origin is itself negative, so truncation would be wrong for the first week of 1970.
 * Mirrors `GgInterval::floor`.
 */
export function intervalFloor(interval: GgInterval, ms: number): number {
  const width = intervalMillis(interval);
  const origin = interval.unit === "week" ? WEEK_ORIGIN_MS : 0;
  return origin + Math.floor((ms - origin) / width) * width;
}

/**
 * The name this aggregation function goes by in the source text, and the first half of
 * an un-aliased column's name. Identity today, but stated once so the source spelling
 * and the wire spelling cannot drift apart silently.
 */
export function aggFuncName(func: GgAggFunc): string {
  return func;
}

/**
 * The column name an aggregation reports under: its alias when it has one, otherwise
 * the source spelling (`avg(score)`, `count()`).
 *
 * Derived rather than stored so an un-aliased column names itself the same way in both
 * implementations and in a saved dashboard — a column name is what a `sort` stage and
 * a visualization bind to, so it has to be a pure function of the query. Mirrors
 * `GgAgg::name`.
 */
export function aggName(agg: GgAgg): string {
  if (agg.alias) return agg.alias;
  if (agg.func === "count") return "count()";
  return `${aggFuncName(agg.func)}(${agg.field ?? ""})`;
}

/**
 * The repository's one linearly interpolated quantile, over an **already sorted**
 * sample — reused verbatim rather than reinvented so gg's box plots match the
 * comparison charts'. Mirrors `crate::comparison_stats::quantile`.
 */
export function quantile(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0]!;
  const clamped = Math.min(1, Math.max(0, q));
  // Rank position in [0, n-1]; the fractional part interpolates between neighbours.
  const pos = clamped * (n - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower]!;
  const weight = pos - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}
