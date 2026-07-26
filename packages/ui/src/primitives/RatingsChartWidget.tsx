import { useMemo } from "react";
import { RATING_META, RATINGS, type Rating } from "../ratings";
import { Chart } from "./Chart";
import { Panel } from "./Panel";
import { stackedBarChart, type StackedBarSegment } from "./plot/charts";
import type { ChartPalette } from "./plot/theme";
import styles from "./MetricChartWidget.module.scss";

// Tilt the model labels so a large roster fits along the axis without overlap
// (matching MetricChartWidget).
const LABEL_ROTATE = -40;

// Static fallbacks for the rating colors, mirroring the `--tcab-rating-*` tokens
// (styles/tokens.css). Used during SSR/prerender, where the live custom
// properties can't be read; the client re-reads the real values at render time.
const RATING_COLOR_FALLBACK: Record<Rating, string> = {
  flawless: "#22d3ee",
  great: "#4ade80",
  passable: "#a3e635",
  scuffed: "#fbbf24",
  broken: "#f87171",
};

// One model's run tally broken down by rating tier — the widget's input, one per
// bar. `counts` carries every tier (including zeros) so a hover can show the full
// breakdown even for tiers with no runs.
export interface RatingCounts {
  /** The bar label (the model's display name). */
  label: string;
  /** How many of the model's runs earned each rating tier. */
  counts: Readonly<Record<Rating, number>>;
}

interface RatingsChartWidgetProps {
  /** Heading naming the chart, e.g. "Ratings". */
  title: string;
  /** One entry per model, in display order (left to right). */
  models: readonly RatingCounts[];
  /** Name of the variant, for the empty-state message. */
  variantName: string;
}

// Reads the live rating colors from the theme, falling back to the static hexes
// during SSR/prerender. Must run on the client to see the real values (touches
// getComputedStyle); called from inside the chart spec, which <Chart> invokes on
// the client.
function readRatingColors(): Record<Rating, string> {
  if (typeof document === "undefined") return RATING_COLOR_FALLBACK;
  const root = getComputedStyle(document.documentElement);
  const read = (rating: Rating): string =>
    root.getPropertyValue(`--tcab-rating-${rating}`).trim() ||
    RATING_COLOR_FALLBACK[rating];
  return {
    flawless: read("flawless"),
    great: read("great"),
    passable: read("passable"),
    scuffed: read("scuffed"),
    broken: read("broken"),
  };
}

// The full per-model breakdown, shown as-is in a bar's hover tooltip: the model
// name followed by the raw count at every rating tier (including zeros).
function breakdownTitle(model: RatingCounts): string {
  const lines = RATINGS.map(
    (rating) => `${RATING_META[rating].label}: ${model.counts[rating]}`,
  );
  return [model.label, ...lines].join("\n");
}

// Turn the per-model tallies into stacked segments — one segment per rating tier
// a model actually has runs in (a zero-count tier gets no segment, but its count
// still appears in every segment's tooltip). Segments are colored by tier through
// the chart's categorical scale, so they carry only their series name here.
function ratingSegments(models: readonly RatingCounts[]): StackedBarSegment[] {
  return models.flatMap((model) => {
    const title = breakdownTitle(model);
    return RATINGS.filter((rating) => model.counts[rating] > 0).map(
      (rating) => ({
        group: model.label,
        series: RATING_META[rating].label,
        value: model.counts[rating],
        title,
      }),
    );
  });
}

// Integer-only y ticks: counts are whole numbers, so a fractional tick (0.5) is
// meaningless. Labelling only integers keeps the axis honest without forcing an
// explicit tick count.
function integerTick(value: number): string {
  return Number.isInteger(value) ? String(value) : "";
}

// A self-contained ratings chart: a titled, full-width panel that charts each
// model's runs as a bar stacked by rating tier (flawless at the base up to
// broken), so the quality mix per model reads at a glance. Hovering a bar shows
// the model's full per-tier breakdown. Like every chart here it shows a
// distribution, not a ranking.
export function RatingsChartWidget({
  title,
  models,
  variantName,
}: RatingsChartWidgetProps) {
  const segments = useMemo(() => ratingSegments(models), [models]);

  // Rating colors are read from the theme when <Chart> invokes the spec on the
  // client, so the chart tracks a live theme swap. Memoized on the segments so
  // it only re-plots when the data changes.
  const spec = useMemo(
    () => (palette: ChartPalette) => {
      const colors = readRatingColors();
      const series = RATINGS.map((rating) => ({
        name: RATING_META[rating].label,
        color: colors[rating],
      }));
      return stackedBarChart(segments, palette, series, {
        y: "runs",
        yTickFormat: integerTick,
        xTickRotate: LABEL_ROTATE,
      });
    },
    [segments],
  );

  return (
    <Panel>
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
      </header>
      {models.length === 0 ? (
        <p className={styles.empty}>
          No reviewed runs of {variantName} yet — ratings appear once runs have
          been reviewed.
        </p>
      ) : (
        <Chart title={`${title} by model`} spec={spec} />
      )}
    </Panel>
  );
}
