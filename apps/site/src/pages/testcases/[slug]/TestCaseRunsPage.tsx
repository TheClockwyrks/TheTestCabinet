import { useMemo } from "react";
import { Link } from "react-router";
import type { RunRecord } from "@test-cabinet/run-record";
import { Chart } from "../../../components/Chart";
import { Panel } from "../../../components/Panel";
import { barChart, boxAndWhisker } from "../../../components/plot/charts";
import type { BarPoint, BoxPoint } from "../../../components/plot/charts";
import { useRuns } from "../../../data/useRuns";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import {
  formatCompact,
  formatRunTime,
  formatUsd,
  totalTokens,
} from "../../../format";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import { routes } from "../../../routes";
import styles from "./TestCaseRunsPage.module.scss";

// How many recent runs to surface inline before the distribution charts.
const RECENT_RUNS = 8;

// The Runs tab (`/test-cases/:slug/runs`): the runs of the selected variant —
// the most recent ones inline, then token and cost distributions. Everything is
// scoped to the page-level variant, so the data here matches the specs shown on
// the Specifications tab. The charts show spread, never a ranking (docs/site.md).
export function TestCaseRunsPage() {
  return (
    <TestCaseDetailLayout tab="runs">
      {({ testCase, variant }) => (
        <RunsContent testCase={testCase} variant={variant} />
      )}
    </TestCaseDetailLayout>
  );
}

function RunsContent({
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

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Recent runs</h2>
        {variantRuns.length === 0 ? (
          <Panel>
            <p className={styles.empty}>No runs of {variant.name} yet.</p>
          </Panel>
        ) : (
          <ul className={styles.runs}>
            {variantRuns.slice(0, RECENT_RUNS).map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
        )}
      </section>

      <CaseCharts runs={variantRuns} variantName={variant.name} />
    </>
  );
}

function RunRow({ run }: { run: RunRecord }) {
  const { subject, metrics, validation } = run;
  return (
    <li>
      <Link to={routes.runDetail(run.id)} className={styles.runRow}>
        <span className={styles.runHarness}>{subject.harnessSlug}</span>
        <span className={styles.runModel}>{subject.modelId}</span>
        <span className={styles.runNum}>{formatCompact(totalTokens(metrics))}</span>
        <span className={styles.runNum}>{formatUsd(metrics.cost.comparable)}</span>
        <span className={styles.runNum}>{formatRunTime(metrics.runTimeSeconds)}</span>
        <span
          className={`${styles.runNum} ${validation.loaded ? styles.ok : styles.bad}`}
        >
          {validation.loaded ? "[Y]" : "[N]"}
        </span>
      </Link>
    </li>
  );
}

// Distribution charts for the variant: token usage and cost grouped by harness
// so the spread across runs is visible without implying a winner.
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
        group: run.subject.harnessSlug,
        value: totalTokens(run.metrics),
      })),
    [runs],
  );
  const costPoints = useMemo<BoxPoint[]>(
    () =>
      runs.map((run) => ({
        group: run.subject.harnessSlug,
        value: run.metrics.cost.comparable,
      })),
    [runs],
  );
  // Per-run magnitudes for the bar charts, keyed by harness (and model when a
  // harness appears more than once) so each bar maps back to one run.
  const tokenBars = useMemo<BarPoint[]>(() => runBars(runs, totalTokensValue), [runs]);
  const costBars = useMemo<BarPoint[]>(() => runBars(runs, costValue), [runs]);

  // A box plot needs a spread to be meaningful; below that we say so.
  if (runs.length < 2) {
    return null;
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Distributions — {variantName}</h2>
      <Panel>
        <div className={styles.charts}>
          <Chart
            title="Total tokens by harness"
            spec={(palette) => boxAndWhisker(tokenPoints, palette, { y: "tokens" })}
          />
          <Chart
            title="Comparable cost by harness"
            spec={(palette) => boxAndWhisker(costPoints, palette, { y: "USD" })}
          />
          <Chart
            title="Total tokens per run"
            spec={(palette) => barChart(tokenBars, palette, { y: "tokens" })}
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

// Builds one labeled bar per run. Labels prefer the harness slug, disambiguating
// with the model id when the same harness ran the variant more than once.
function runBars(runs: RunRecord[], value: (run: RunRecord) => number): BarPoint[] {
  const counts = new Map<string, number>();
  for (const run of runs) {
    counts.set(run.subject.harnessSlug, (counts.get(run.subject.harnessSlug) ?? 0) + 1);
  }
  return runs.map((run) => ({
    label:
      (counts.get(run.subject.harnessSlug) ?? 0) > 1
        ? `${run.subject.harnessSlug} · ${run.subject.modelId}`
        : run.subject.harnessSlug,
    value: value(run),
  }));
}
