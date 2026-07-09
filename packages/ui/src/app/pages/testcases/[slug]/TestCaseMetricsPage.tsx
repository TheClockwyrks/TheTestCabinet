import { useMemo } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { MetricChartWidget, Panel } from "@test-cabinet/ui";
import { useRunSummaries } from "../../../data/useRuns";
import { useFindModel } from "../../../data/useModels";
import {
  providerColor,
  UNKNOWN_PROVIDER_COLOR,
} from "../../../data/providerColor";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { totalTokens } from "../../../format";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import styles from "./TestCaseMetricsPage.module.scss";

// A box plot needs more than one observation to show a spread.
const MIN_RUNS = 2;

// Compact d3-format for the token axis so large counts (100k, 1.2M) stay short
// and aren't clipped by the chart's left margin. Cost values are small enough to
// render in full, so they keep the default axis formatting.
const TOKEN_TICKS = "~s";

// Value accessors for the two metric widgets. Module-level so their identity is
// stable across renders (the widgets memoize their chart data on them).
// Null for a harness that doesn't report every token class; such runs are then
// excluded from the token chart rather than charted with an incomplete total.
const tokensValue = (run: RunSummary): number | null => totalTokens(run.metrics);
// Null when the run's comparable cost is unknown (the model's prices could not
// be resolved); such runs are excluded from the cost chart rather than charted
// as zero.
const costValue = (run: RunSummary): number | null => run.metrics.cost.comparable;

// The Metrics tab (`/test-cases/:slug/metrics`): token and cost distributions
// for the selected variant, grouped by model so the spread across runs is
// visible without implying a winner. The charts show spread, never a ranking
// (docs/site.md).
export function TestCaseMetricsPage() {
  return (
    <TestCaseDetailLayout tab="metrics">
      {({ testCase, variant }) => (
        <MetricsContent testCase={testCase} variant={variant} />
      )}
    </TestCaseDetailLayout>
  );
}

function MetricsContent({
  testCase,
  variant,
}: {
  testCase: TestCaseSummary;
  variant: VariantSummary;
}) {
  const { runSummaries } = useRunSummaries();
  const findModel = useFindModel();

  // Colors each model's bar by its provider's brand color, so a glance groups the
  // roster by provider. A provider we have no color for (or a model missing from
  // the catalog) falls back to a neutral grey. Memoized on the catalog resolver so
  // the widget's bar data stays stable across re-renders.
  const colorForModel = useMemo(
    () =>
      (modelId: string): string =>
        providerColor(findModel(modelId)?.provider ?? "") ??
        UNKNOWN_PROVIDER_COLOR,
    [findModel],
  );

  // Completed runs of this case and variant, newest first. Memoized so the chart
  // specs are stable across re-renders. Failed runs produced no metrics (their
  // cost and tokens are zero), so charting them would skew the distribution.
  const variantRuns = useMemo(
    () =>
      runSummaries
        .filter(
          (run) =>
            run.subject.testCaseSlug === testCase.slug &&
            run.subject.variant === variant.slug &&
            run.state === "completed",
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [runSummaries, testCase.slug, variant.slug],
  );

  if (variantRuns.length < MIN_RUNS) {
    return (
      <section className={styles.section}>
        <Panel>
          <p className={styles.empty}>
            Need at least {MIN_RUNS} runs of {variant.name} to chart a
            distribution.
          </p>
        </Panel>
      </section>
    );
  }

  // One full-width widget per metric, each switchable between the box-and-whisker
  // spread and the per-run bars.
  return (
    <section className={styles.section}>
      <div className={styles.widgets}>
        <MetricChartWidget
          title="Average tokens"
          runs={variantRuns}
          value={tokensValue}
          unit="tokens"
          yTickFormat={TOKEN_TICKS}
          barMode="meanByModel"
          colorForModel={colorForModel}
        />
        <MetricChartWidget
          title="Average cost"
          runs={variantRuns}
          value={costValue}
          unit="USD"
          barMode="meanByModel"
          colorForModel={colorForModel}
        />
      </div>
    </section>
  );
}
