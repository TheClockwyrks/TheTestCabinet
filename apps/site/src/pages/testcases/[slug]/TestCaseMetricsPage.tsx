import { useMemo } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import { Chart } from "../../../components/Chart";
import { Panel } from "../../../components/Panel";
import { barChart, boxAndWhisker } from "../../../components/plot/charts";
import type { BarPoint, BoxPoint } from "../../../components/plot/charts";
import { useRuns } from "../../../data/useRuns";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { totalTokens } from "../../../format";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import styles from "./TestCaseMetricsPage.module.scss";

// A box plot needs more than one observation to show a spread.
const MIN_RUNS = 2;

// Compact d3-format for the token axes so large counts (100k, 1.2M) stay short
// and aren't clipped by the chart's left margin. Cost values are small enough to
// render in full, so they keep the default axis formatting.
const TOKEN_TICKS = "~s";

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

  return <CaseCharts runs={variantRuns} variantName={variant.name} />;
}

// Distribution charts for the variant: token usage and cost grouped by model so
// the spread across runs is visible without implying a winner.
function CaseCharts({
  runs,
  variantName,
}: {
  runs: RunRecord[];
  variantName: string;
}) {
  const tokenPoints = useMemo<BoxPoint[]>(
    () =>
      runs.map((run) => ({
        group: run.subject.modelId,
        value: totalTokens(run.metrics),
      })),
    [runs],
  );
  const costPoints = useMemo<BoxPoint[]>(
    () =>
      runs.map((run) => ({
        group: run.subject.modelId,
        value: run.metrics.cost.comparable,
      })),
    [runs],
  );
  // Per-run magnitudes for the bar charts, keyed by model (and harness when a
  // model appears more than once) so each bar maps back to one run.
  const tokenBars = useMemo<BarPoint[]>(() => runBars(runs, totalTokensValue), [runs]);
  const costBars = useMemo<BarPoint[]>(() => runBars(runs, costValue), [runs]);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Distributions — {variantName}</h2>
      <Panel>
        <div className={styles.charts}>
          <Chart
            title="Total tokens by model"
            spec={(palette) =>
              boxAndWhisker(tokenPoints, palette, {
                y: "tokens",
                yTickFormat: TOKEN_TICKS,
              })
            }
          />
          <Chart
            title="Comparable cost by model"
            spec={(palette) => boxAndWhisker(costPoints, palette, { y: "USD" })}
          />
          <Chart
            title="Total tokens per run"
            spec={(palette) =>
              barChart(tokenBars, palette, {
                y: "tokens",
                yTickFormat: TOKEN_TICKS,
              })
            }
          />
          <Chart
            title="Comparable cost per run"
            spec={(palette) => barChart(costBars, palette, { y: "USD" })}
          />
        </div>
      </Panel>
    </section>
  );
}

function totalTokensValue(run: RunRecord): number {
  return totalTokens(run.metrics);
}

function costValue(run: RunRecord): number {
  return run.metrics.cost.comparable;
}

// Builds one labeled bar per run. Labels prefer the model id, disambiguating
// with the harness slug when the same model ran the variant more than once.
function runBars(runs: RunRecord[], value: (run: RunRecord) => number): BarPoint[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    counts.set(run.subject.modelId, (counts.get(run.subject.modelId) ?? 0) + 1);
  }
  return runs.map((run) => ({
    label:
      (counts.get(run.subject.modelId) ?? 0) > 1
        ? `${run.subject.modelId} · ${run.subject.harnessSlug}`
        : run.subject.modelId,
    value: value(run),
  }));
}
