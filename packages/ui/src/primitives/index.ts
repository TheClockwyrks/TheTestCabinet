// Brand-neutral presentational primitives shared across the GUIs. They read the
// `--tcab-*` token contract (styles/tokens.css) so each app themes them.
export { Avatar, type AvatarProps } from "./Avatar";
export {
  Dialog,
  type DialogAction,
  type DialogActionTone,
  type DialogProps,
} from "./Dialog";
export { Markdown } from "./Markdown";
export { RatingBadge } from "./RatingBadge";
export { FailureCapBadge, type FailureCapOutcome } from "./FailureCapBadge";
export { AestheticBadge } from "./AestheticBadge";
export { GradeBadge } from "./GradeBadge";
export { Panel } from "./Panel";
export { Spinner, type SpinnerProps, type SpinnerVariant } from "./Spinner";
export { StatusGlyph, type StatusGlyphStatus } from "./StatusGlyph";
export { Pagination } from "./Pagination";
export { ProgressBar } from "./ProgressBar";
export { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
export { MetricTile } from "./MetricTile";
export { SpecAccordion, type AccordionEntry } from "./SpecAccordion";
export { Chart } from "./Chart";
export { ChartWidget, SectionWidget } from "./ChartWidget";
export { ChartSortControl } from "./ChartSortControl";
export { ChartModeControl, type ChartMode } from "./ChartModeControl";
export {
  orderBars,
  type BetterIs,
  type ChartSort,
  type ChartTieBreak,
} from "./chartSort";
export { DonutChartWidget, type DonutSegment } from "./DonutChartWidget";
export { MetricChartWidget, type BarBuildOptions } from "./MetricChartWidget";
export { RatingsChartWidget, type RatingCounts } from "./RatingsChartWidget";
export {
  ReliabilityRingWidget,
  type ReliabilitySegment,
  type ReliabilityTone,
} from "./ReliabilityRingWidget";
export {
  Treemap,
  placeTreemapTiles,
  type TreemapTile,
  type PlacedTreemapTile,
  type TreemapLegendKey,
  type TreemapLegendKind,
} from "./plot/Treemap";
export {
  barChart,
  horizontalBarChart,
  stackedBarChart,
  stackedAreaChart,
  metricLineChart,
  timeSeriesChart,
  distributionChart,
  scatterChart,
  type BarPoint,
  type BarDistribution,
  type ScatterGroup,
  type ScatterLabels,
  type HorizontalBarPoint,
  type HorizontalBarLabels,
  type StackedBarSegment,
  type StackedSeries,
  type StackedAreaPoint,
  type StackedAreaMarker,
  type MetricPoint,
  type MetricLineLabels,
  type TimeSeriesPoint,
  type TimeSeriesLabels,
  type DistributionPoint,
  type DistributionGroup,
} from "./plot/charts";
export {
  basePlotOptions,
  readChartPalette,
  type ChartPalette,
} from "./plot/theme";
export {
  quantile,
  summarizeValues,
  type DistributionStats,
} from "./plot/distribution";
export { CATEGORICAL_COLORS, categoricalColor } from "./plot/palette";
