import { useMemo } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import {
  canonicalModelId,
  MetricChartWidget,
  Panel,
  RatingsChartWidget,
  type RatingCounts,
} from "@test-cabinet/ui";
import {
  useVersionScope,
  versionInScope,
  VersionScopeControl,
} from "../../../components/VersionScope";
import { useCaseRunSummaries } from "../../../data/useRuns";
import { useFindModel } from "../../../data/useModels";
import { useFindReview } from "../../../data/writeups";
import type { Rating } from "../../../data/ratings";
import {
  providerColor,
  UNKNOWN_PROVIDER_COLOR,
} from "../../../data/providerColor";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { LoadingState } from "../../../components/LoadingState";
import { formatCompact, formatUsd, totalTokens } from "../../../format";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import { resolveRunScore } from "./TestCaseLeaderboardPage";
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
const tokensValue = (run: RunSummary): number | null =>
  totalTokens(run.metrics);
// Null when the run's comparable cost is unknown (the model's prices could not
// be resolved); such runs are excluded from the cost chart rather than charted
// as zero.
const costValue = (run: RunSummary): number | null =>
  run.metrics.cost.comparable;

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

// The metrics body, given the resolved case and variant. Exported so the
// game-jam detail's Metrics tab renders the identical distributions under its own
// layout — run metrics (tokens, cost) are review-model-independent.
export function MetricsContent({
  testCase,
  variant,
}: {
  testCase: TestCaseSummary;
  variant: VariantSummary;
}) {
  const { summaries, localWriteups, loading } = useCaseRunSummaries(
    testCase.slug,
  );
  const findModel = useFindModel();
  const findReview = useFindReview();

  // The version scope the visitor has chosen — the same control, and the same
  // `current` default, the Leaderboard tab carries, so the charts and the board
  // describe the same cohort of runs unless the visitor scopes one of them.
  const versionScope = useVersionScope(testCase);
  const { scope, specificVersion } = versionScope;

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

  // Labels each model's bar by its catalog display name ("Anthropic Claude Opus
  // 4.8") in place of the raw slug, falling back to the id for a model missing
  // from the catalog. Memoized on the resolver so the bar data stays stable.
  const labelForModel = useMemo(
    () =>
      (modelId: string): string =>
        findModel(modelId)?.name ?? modelId,
    [findModel],
  );

  // Completed runs of this case and variant, newest first. Memoized so the chart
  // specs are stable across re-renders. Failed runs produced no metrics (their
  // cost and tokens are zero), so charting them would skew the distribution.
  const variantRuns = useMemo(
    () =>
      summaries
        .filter(
          (run) =>
            run.subject.testCaseSlug === testCase.slug &&
            run.subject.variant === variant.slug &&
            run.state === "completed",
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [summaries, testCase.slug, variant.slug],
  );

  // Narrowed to the selected version scope. Kept separate from `variantRuns` so
  // flipping the scope re-filters without re-scanning every summary.
  const scopedRuns = useMemo(
    () =>
      variantRuns.filter((run) =>
        versionInScope(
          run.subject.testCaseVersion,
          scope,
          testCase.latestVersion,
          specificVersion,
        ),
      ),
    [variantRuns, scope, testCase.latestVersion, specificVersion],
  );

  // Each model's scoped runs tallied by overall rating, for the stacked ratings
  // chart. The overall rating per run is resolved the same way the leaderboard
  // does it (enriched summary card, else local writeup), so the two tabs agree;
  // runs with no resolvable rating are simply left out of the tally. Models are
  // keyed and labeled the same way as the token/cost charts so all three read as
  // the same roster.
  const ratingModels = useMemo<RatingCounts[]>(() => {
    const byModel = new Map<string, Record<Rating, number>>();
    const order: string[] = [];
    for (const run of scopedRuns) {
      const scored = resolveRunScore(run, variant, findReview, localWriteups);
      if (!scored || !scored.rating) continue;
      const modelId = canonicalModelId(run.subject.modelId);
      let counts = byModel.get(modelId);
      if (!counts) {
        counts = { flawless: 0, great: 0, passable: 0, scuffed: 0, broken: 0 };
        byModel.set(modelId, counts);
        order.push(modelId);
      }
      counts[scored.rating] += 1;
    }
    return order.map((modelId) => ({
      label: labelForModel(modelId),
      counts: byModel.get(modelId)!,
    }));
  }, [scopedRuns, variant, findReview, localWriteups, labelForModel]);

  return (
    <section className={styles.section}>
      <VersionScopeControl state={versionScope} />

      {/* The case's runs drain over several requests, so a count taken mid-drain
          is meaningless — it would report "not enough runs" about a set that is
          still arriving. Wait for it to settle before judging the sample size. */}
      {loading ? (
        <LoadingState size="section" label="Loading metrics…" />
      ) : scopedRuns.length < MIN_RUNS ? (
        <Panel>
          <p className={styles.empty}>
            Need at least {MIN_RUNS} runs of {variant.name} to chart a
            distribution.
          </p>
        </Panel>
      ) : (
        // One full-width widget per metric, each grouping the scoped runs by model.
        <div className={styles.widgets}>
          <RatingsChartWidget
            title="Ratings"
            models={ratingModels}
            variantName={variant.name}
          />
          <MetricChartWidget
            title="Average tokens"
            runs={scopedRuns}
            value={tokensValue}
            unit="tokens"
            yTickFormat={TOKEN_TICKS}
            barMode="meanByModel"
            colorForModel={colorForModel}
            labelForModel={labelForModel}
            formatValue={formatCompact}
          />
          <MetricChartWidget
            title="Average cost"
            runs={scopedRuns}
            value={costValue}
            unit="USD"
            barMode="meanByModel"
            colorForModel={colorForModel}
            labelForModel={labelForModel}
            formatValue={formatUsd}
          />
        </div>
      )}
    </section>
  );
}
