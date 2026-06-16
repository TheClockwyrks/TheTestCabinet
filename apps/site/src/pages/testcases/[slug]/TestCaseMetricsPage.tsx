import { useMemo } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import { MetricChartWidget } from "../../../components/MetricChartWidget";
import { Panel } from "../../../components/Panel";
import { useRuns } from "../../../data/useRuns";
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
const tokensValue = (run: RunRecord): number => totalTokens(run.metrics);
const costValue = (run: RunRecord): number => run.metrics.cost.comparable;

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
  const { runs } = useRuns();

  // Runs of this case and variant, newest first. Memoized so the chart specs are
  // stable across re-renders.
  const variantRuns = useMemo(
    () =>
      runs
        .filter(
          (run) =>
            run.subject.testCaseSlug === testCase.slug &&
            run.subject.variant === variant.slug,
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [runs, testCase.slug, variant.slug],
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
        />
        <MetricChartWidget
          title="Average cost"
          runs={variantRuns}
          value={costValue}
          unit="USD"
          barMode="meanByModel"
        />
      </div>
    </section>
  );
}
