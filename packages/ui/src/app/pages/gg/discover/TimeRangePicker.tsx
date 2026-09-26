// The **time range** — the one scope that sits outside the query text.
//
// Two reasons it is not simply a clause the operator types. A dashboard has exactly one
// time picker for the whole board (a panel never gets its own range), so the range has to
// be a thing that can be applied *to* a query rather than a thing inside one; and a range
// is the filter people change constantly while leaving the question alone, which is a
// control, not an edit.
//
// Each preset carries an **explicit histogram interval**. There is deliberately no `auto`
// interval anywhere in TCQ: it has no representation in a compiled query, and it is
// genuinely unresolvable on the client for a query with no time bound at all. Pinning the
// interval to the range is what makes "sessions over time" a one-click question with a
// sensible bucket width instead of a guess.
import type { GgFilter, GgInterval } from "@clockwyrks/run-record/gg-query";
import styles from "./GgDiscover.module.scss";

/** One offered range. */
export interface TimeRange {
  /** The URL token, and the picker's stable value. */
  id: string;
  label: string;
  /** How far back the range reaches, in milliseconds, or `null` for the whole corpus. */
  spanMs: number | null;
  /** The date-histogram width a chart over this range should use. */
  interval: GgInterval;
}

/**
 * The offered ranges.
 *
 * The widths are chosen so a histogram over each lands between roughly twenty and a
 * hundred buckets — enough shape to read a trend, few enough that the points do not turn
 * into a smear. "All time" keeps a weekly bucket because the corpus only grows.
 */
export const TIME_RANGES: readonly TimeRange[] = [
  {
    id: "24h",
    label: "Last 24 hours",
    spanMs: 86_400_000,
    interval: { count: 1, unit: "hour" },
  },
  {
    id: "7d",
    label: "Last 7 days",
    spanMs: 604_800_000,
    interval: { count: 6, unit: "hour" },
  },
  {
    id: "30d",
    label: "Last 30 days",
    spanMs: 2_592_000_000,
    interval: { count: 1, unit: "day" },
  },
  {
    id: "90d",
    label: "Last 90 days",
    spanMs: 7_776_000_000,
    interval: { count: 1, unit: "day" },
  },
  {
    id: "1y",
    label: "Last year",
    spanMs: 31_536_000_000,
    interval: { count: 1, unit: "week" },
  },
  {
    id: "all",
    label: "All time",
    spanMs: null,
    interval: { count: 1, unit: "week" },
  },
];

/**
 * The range Discover opens on.
 *
 * All time, not a recent window. gg runs are experiment material recorded in bursts —
 * a week of comparing configurations, then nothing for a month — so a surface that opened
 * on "last 7 days" would greet most operators with an empty result and no clue that the
 * corpus is fine.
 */
export const DEFAULT_RANGE = TIME_RANGES[TIME_RANGES.length - 1]!;

/** The range a URL token names, falling back to the default so a stale or hand-edited
 *  link still opens on something. */
export function rangeById(id: string | null | undefined): TimeRange {
  return TIME_RANGES.find((range) => range.id === id) ?? DEFAULT_RANGE;
}

/**
 * The filter clause a range stands for, or `null` for the unbounded one.
 *
 * Resolved against an injected `now` rather than the clock so the compiled query carries
 * absolute milliseconds — the server never needs a clock, and a *saved* view keeps the
 * relative range and re-resolves it on every run.
 *
 * It bounds `started`, not `finished`: a run that is still going has no finish timestamp
 * at all, so bounding on that would quietly exclude exactly the runs an operator opening
 * "last 24 hours" is most likely to be looking for.
 */
export function rangeFilter(range: TimeRange, now: number): GgFilter | null {
  if (range.spanMs === null) return null;
  return { kind: "range", field: "started", from: now - range.spanMs };
}

interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

/** The range control, as a plain select: six options is a menu, not a segmented row, and
 *  a select stays usable at every width the console renders at. */
export function TimeRangePicker({ value, onChange }: TimeRangePickerProps) {
  return (
    <label className={styles.rangeField}>
      <span className={styles.rangeLabel}>Range</span>
      <select
        className={styles.rangeSelect}
        value={value.id}
        aria-label="Time range"
        onChange={(event) => onChange(rangeById(event.target.value))}
      >
        {TIME_RANGES.map((range) => (
          <option key={range.id} value={range.id}>
            {range.label}
          </option>
        ))}
      </select>
    </label>
  );
}
