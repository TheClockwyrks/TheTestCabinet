import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
import type { ChartSort } from "./chartSort";

const SORT_OPTIONS: ReadonlyArray<SegmentedOption<ChartSort>> = [
  { value: "alphabetical", label: "Alphabetical" },
  { value: "best", label: "Best" },
];

// The chart-order toggle, in the same sliding segmented track the version scope
// uses so the two read as one family of controls. It carries no state of its
// own: a page that shows several charts holds one `ChartSort` and renders this
// control into each chart's header, which is what makes the sliders move
// together.
export function ChartSortControl({
  value,
  onChange,
}: {
  value: ChartSort;
  onChange: (sort: ChartSort) => void;
}) {
  return (
    <SegmentedControl
      options={SORT_OPTIONS}
      value={value}
      onChange={onChange}
      ariaLabel="Chart order"
    />
  );
}
