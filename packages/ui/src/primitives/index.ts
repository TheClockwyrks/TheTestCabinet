// Brand-neutral presentational primitives shared across the GUIs. They read the
// `--tcab-*` token contract (styles/tokens.css) so each app themes them.
export { Markdown } from "./Markdown";
export { RatingBadge } from "./RatingBadge";
export { GradeBadge } from "./GradeBadge";
export { Panel } from "./Panel";
export { Pagination } from "./Pagination";
export { ProgressBar } from "./ProgressBar";
export { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
export { MetricTile } from "./MetricTile";
export { SpecAccordion, type AccordionEntry } from "./SpecAccordion";
export { Chart } from "./Chart";
export { MetricChartWidget } from "./MetricChartWidget";
export { RatingsChartWidget, type RatingCounts } from "./RatingsChartWidget";
export {
  ReliabilityRingWidget,
  type ReliabilitySegment,
  type ReliabilityTone,
} from "./ReliabilityRingWidget";
export {
  barChart,
  stackedBarChart,
  priceHistoryChart,
  type BarPoint,
  type StackedBarSegment,
  type StackedSeries,
  type PricePoint,
} from "./plot/charts";
export {
  basePlotOptions,
  readChartPalette,
  type ChartPalette,
} from "./plot/theme";
