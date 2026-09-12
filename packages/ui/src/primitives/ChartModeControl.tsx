import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";

/**
 * How a metric chart draws the runs behind each `(harness, model)` group.
 *
 * - `bar`: one bar per group at its mean. Hovering a bar swaps it for the
 *   box-and-whiskers of the runs it averages, so the spread is one gesture away
 *   without the resting chart becoming busy.
 * - `scatter`: every run as its own dot, with a rule at the group's average.
 *   This is the view that makes the sample size visible: `n = 2` and `n = 20`
 *   draw the same bar and very different scatters.
 */
export type ChartMode = "bar" | "scatter";

const MODE_OPTIONS: ReadonlyArray<SegmentedOption<ChartMode>> = [
  { value: "bar", label: "Bar" },
  { value: "scatter", label: "Scatter" },
];

/**
 * The chart-mode toggle, in the same sliding segmented track the chart order and
 * the version scope use so the controls in a chart's header read as one family.
 *
 * Unlike {@link ChartSortControl} this is deliberately **per chart**. The order
 * control is linked across a page because four charts describing one roster are
 * only comparable while they agree on where each bar sits; how one of them draws
 * its own distribution is nobody else's business, and linking it would mean a
 * reader could not put a scatter of cost beside a bar of tokens.
 *
 * `ariaLabel` is required for that reason too: a page carries several of these,
 * and "Chart display" three times over tells a screen-reader user nothing about
 * which chart they are on.
 */
export function ChartModeControl({
  value,
  onChange,
  ariaLabel,
}: {
  value: ChartMode;
  onChange: (mode: ChartMode) => void;
  ariaLabel: string;
}) {
  return (
    <SegmentedControl
      options={MODE_OPTIONS}
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
    />
  );
}
