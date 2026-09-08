import {
  DonutChartWidget,
  MetricTile,
  Panel,
  RatingsChartWidget,
  type DonutSegment,
} from "@clockwyrks/ui";
import { RATING_META } from "../../data/ratings";
import { LoadingState } from "../../components/LoadingState";
import { formatInteger } from "../../format";
import type { CoverageRunMetrics, CoverageSlice } from "./coverageMetrics";
import styles from "./Coverage.module.scss";

// The categorical ring palette, matching the account overview's: the accent leads it,
// and any overflow beyond the top slices folds into a muted "Other".
const CATEGORY_COLORS = [
  "#ff9d2f", // accent orange
  "#a855f7", // violet
  "#22d3ee", // cyan
  "#4ade80", // green
  "#f472b6", // pink
  "#facc15", // amber
  "#60a5fa", // blue
  "#fb7185", // rose
];
const OTHER_COLOR = "var(--tcab-muted)";

// How many named slices a categorical ring shows before the remainder folds into a
// single "Other" slice — enough to be informative without a legend that runs long.
const TOP_SLICES = 8;

// Turn a breakdown into donut segments: the largest `TOP_SLICES` keyed by the palette,
// with any remainder folded into one muted "Other" slice so a long tail does not crowd
// the legend.
function donutSegments(slices: readonly CoverageSlice[]): DonutSegment[] {
  const top = slices.slice(0, TOP_SLICES);
  const rest = slices.slice(TOP_SLICES);
  const segments: DonutSegment[] = top.map((slice, i) => ({
    label: slice.label,
    value: slice.count,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] ?? OTHER_COLOR,
  }));
  if (rest.length > 0) {
    segments.push({
      label: `Other (${rest.length})`,
      value: rest.reduce((sum, slice) => sum + slice.count, 0),
      color: OTHER_COLOR,
    });
  }
  return segments;
}

/**
 * What the plan's runs actually were, beside what the plan still wants.
 *
 * The board above these counts runs per cell; this describes them. A plan can be fully
 * covered and still be a plan whose every run is broken, so the two are shown together
 * and neither stands in for the other.
 */
export function CoveragePlanMetrics({
  metrics,
  loading,
  error,
}: {
  metrics: CoverageRunMetrics;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <Panel className={styles.metricsPanel}>
        <LoadingState size="section" label="Loading this plan's runs…" />
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel className={styles.metricsPanel}>
        <h2 className={styles.metricsTitle}>Runs covered</h2>
        <p className={styles.metricsEmpty}>
          This plan&rsquo;s runs could not be read, so the breakdowns below are
          unavailable. {error}
        </p>
      </Panel>
    );
  }
  if (metrics.total === 0) {
    return (
      <Panel className={styles.metricsPanel}>
        <h2 className={styles.metricsTitle}>Runs covered</h2>
        <p className={styles.metricsEmpty}>
          No recorded runs match this plan&rsquo;s cells yet. Top it up, or
          trigger a cell by hand, and the breakdowns appear here as runs land.
        </p>
      </Panel>
    );
  }

  const unrated = metrics.total - metrics.rated;
  const ratingSegments: DonutSegment[] = metrics.ratings.map((slice) => ({
    label: RATING_META[slice.rating].label,
    value: slice.count,
    color: `var(--tcab-rating-${slice.rating})`,
  }));

  return (
    <>
      <Panel className={styles.metricsPanel}>
        <h2 className={styles.metricsTitle}>Runs covered</h2>
        {metrics.truncated && (
          <p className={styles.metricsEmpty}>
            These figures cover the newest runs of this plan&rsquo;s cases
            rather than every one of them.
          </p>
        )}
        <div className={styles.metricTiles}>
          <MetricTile label="Runs" value={formatInteger(metrics.total)} />
          <MetricTile
            label="Rated"
            value={formatInteger(metrics.rated)}
            title="Runs carrying a functional rating. A validator-rated run has one from the moment it completes."
          />
          <MetricTile
            label="Unrated"
            value={formatInteger(unrated)}
            secondary
            title="Runs with no functional rating yet — a legacy run nobody has reviewed."
          />
          <MetricTile
            label="Reviewed"
            value={formatInteger(metrics.reviewed)}
            title="Runs carrying at least one review of yours or anyone else's."
          />
          <MetricTile
            label="Combinations"
            value={formatInteger(metrics.byCombination.length)}
            secondary
          />
          <MetricTile
            label="Test cases"
            value={formatInteger(metrics.byCase.length)}
            secondary
          />
        </div>
        <div className={styles.metricCharts}>
          <DonutChartWidget
            framed={false}
            title="By model"
            segments={donutSegments(metrics.byModel)}
            total={metrics.total}
            centerLabel="runs"
            emptyMessage="No runs yet."
          />
          {/* Beside the model rather than instead of it: one model run under two
              harnesses, or under two gg configurations, is several populations that
              the model alone folds into one. */}
          <DonutChartWidget
            framed={false}
            title="By combination"
            segments={donutSegments(metrics.byCombination)}
            total={metrics.total}
            centerLabel="runs"
            emptyMessage="No runs yet."
          />
          <DonutChartWidget
            framed={false}
            title="By test case"
            segments={donutSegments(metrics.byCase)}
            total={metrics.total}
            centerLabel="runs"
            emptyMessage="No runs yet."
          />
          {/* The ring's denominator is every run, so the unrated remainder shows
              through as uncolored track rather than being quietly dropped from the
              plan's quality picture. */}
          <DonutChartWidget
            framed={false}
            title="By rating"
            segments={ratingSegments}
            total={metrics.total}
            centerLabel="runs"
            emptyMessage="No rated runs yet."
          />
        </div>
      </Panel>
      <RatingsChartWidget
        title="Ratings by combination"
        models={metrics.ratingsByCombination}
        variantName="this plan"
      />
    </>
  );
}
