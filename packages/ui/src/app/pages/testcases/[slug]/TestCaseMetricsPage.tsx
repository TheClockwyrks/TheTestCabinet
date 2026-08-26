import { useCallback, useMemo, useState } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import {
  canonicalModelId,
  ChartSortControl,
  formatPoints,
  MetricChartWidget,
  Panel,
  RatingsChartWidget,
  type ChartSort,
  type RatingCounts,
} from "@test-cabinet/ui";
import {
  AnchoredScopeControls,
  useAnchoredScope,
} from "../../../components/anchoredScope";
import { engineName } from "../../../data/engines";
import { useCaseRunSummaries } from "../../../data/useRuns";
import { useFindModel } from "../../../data/useModels";
import { useFindReview } from "../../../data/writeups";
import { isGgRun } from "../../../data/runLinks";
import type { Rating } from "../../../data/ratings";
import {
  providerColor,
  UNKNOWN_PROVIDER_COLOR,
} from "../../../data/providerColor";
import { LoadingState } from "../../../components/LoadingState";
import { formatCompact, formatUsd, totalTokens } from "../../../format";
import {
  TestCaseDetailLayout,
  type DetailTabContext,
} from "../../../layouts/testcases/TestCaseDetailLayout";
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

// The bar label every chart on this tab agrees on: the model's display name and
// the harness that ran it, plus — only on a board widened across engines — the
// engine, so two engines' runs read as two bars. It mirrors
// `MetricChartWidget`'s own pair (+ subgroup) label, which is what lets one
// points-per-bar lookup serve as the tie-break for all four charts (they are
// all describing the same roster).
function pairLabel(
  modelName: string,
  harnessSlug: string,
  engineLabel: string | null,
): string {
  const pair = `${modelName} · ${harnessSlug}`;
  return engineLabel ? `${pair} · ${engineLabel}` : pair;
}

// The Metrics tab (`/test-cases/:slug/metrics`): rating, points, token and cost
// distributions for the selected variant, grouped by model so the spread across
// runs is visible without implying a winner. The charts show spread, never a
// ranking (docs/site.md) — the shared order control reorders the bars, it does
// not turn the charts into a leaderboard.
export function TestCaseMetricsPage() {
  return (
    <TestCaseDetailLayout tab="metrics">
      {(ctx) => <MetricsContent ctx={ctx} />}
    </TestCaseDetailLayout>
  );
}

// The metrics body, given the page's anchored coordinate. Exported so the
// game-jam detail's Metrics tab renders the identical distributions under its own
// layout — run metrics (tokens, cost) are review-model-independent, and the
// points chart reads a jam's graded checklist through the same scorer.
export function MetricsContent({ ctx }: { ctx: DetailTabContext }) {
  const { testCase, version, engine, variant } = ctx;
  const { summaries, localWriteups, loading } = useCaseRunSummaries(
    testCase.slug,
  );
  const findModel = useFindModel();
  const findReview = useFindReview();

  // The scope the visitor has chosen, relative to the page's anchored
  // coordinate — the same controls (and the same query params) the Runs and
  // Leaderboard tabs carry, so the charts and the board describe the same
  // cohort of runs.
  // The engine widener is offered only when the anchored version supports more
  // than one engine — with one engine there is nothing to widen into, and the
  // hook then reads the anchored scope regardless of a stale `?engines=all`.
  const multiEngine = (testCase.enginesByVersion[version] ?? []).length > 1;
  const anchoredScope = useAnchoredScope({
    version,
    versions: testCase.versions,
    engineWidenable: multiEngine,
  });
  const { versionScope, engineScope } = anchoredScope;
  const engineWidened = engineScope === "all";

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
  // cost and tokens are zero), so charting them would skew the distribution. gg
  // runs are excluded from every per-model chart on this tab: a gg run's agents
  // may span several models, so it has no single model to plot on a per-model
  // axis (see docs/comparisons/metrics-split). Its results live in gg's own
  // aggregation views.
  const variantRuns = useMemo(
    () =>
      summaries
        .filter(
          (run) =>
            run.subject.testCaseSlug === testCase.slug &&
            run.subject.variant === variant.slug &&
            run.state === "completed" &&
            !isGgRun(run.subject.harnessSlug),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [summaries, testCase.slug, variant.slug],
  );

  // Narrowed to the selected scope. Kept separate from `variantRuns` so
  // flipping the scope re-filters without re-scanning every summary. Runs under
  // a different engine measure different work: the anchored engine scope keeps
  // them out entirely, and the widened scope splits them into per-engine bars
  // (see `engineSubgroup`) rather than folding them together. A summary from
  // before engine selection existed reads as the engineless "none".
  const scopedRuns = useMemo(
    () =>
      // Version membership comes from the scope's catalog-version list — the
      // same list the Runs tab's server query sends — so the charts, the board
      // and the run list count one cohort.
      variantRuns.filter(
        (run) =>
          anchoredScope.inVersionScope(run.subject.testCaseVersion) &&
          (engineWidened || (run.subject.engineSlug ?? "none") === engine),
      ),
    [
      variantRuns,
      versionScope,
      version,
      testCase.versions,
      engineWidened,
      engine,
    ],
  );

  // The extra per-engine grouping the metric widgets fold by when the tab is
  // widened across engines: runs under different engines are never averaged
  // into one bar, and each bar's label names its engine. Undefined in the
  // (common) anchored view, where every run shares the anchored engine.
  const engineSubgroup = useMemo(
    () =>
      engineWidened
        ? (run: RunSummary) => {
            const slug = run.subject.engineSlug ?? "none";
            return { key: slug, label: engineName(slug) };
          }
        : undefined,
    [engineWidened],
  );

  // Each `(harness, model)` pair's scoped runs tallied by overall rating, for the
  // stacked ratings chart. The overall rating per run is resolved the same way the
  // leaderboard does it (enriched summary card, else local writeup), so the two
  // tabs agree; runs with no resolvable rating are simply left out of the tally.
  // Pairs are keyed and labeled the same way as the token/cost charts (harness ·
  // model, plus the engine when widened across engines) so all three read as the
  // same roster and never merge two harnesses — or two engines — of a model into
  // one bar.
  const ratingModels = useMemo<RatingCounts[]>(() => {
    interface Group {
      modelId: string;
      harness: string;
      engineLabel: string | null;
      counts: Record<Rating, number>;
    }
    const byPair = new Map<string, Group>();
    const order: string[] = [];
    for (const run of scopedRuns) {
      const scored = resolveRunScore(run, variant, findReview, localWriteups);
      if (!scored || !scored.rating) continue;
      const harness = run.subject.harnessSlug;
      const modelId = canonicalModelId(run.subject.modelId, harness);
      const sub = engineSubgroup?.(run);
      // The (harness, model[, engine]) fold key, NUL-separated: the one character
      // none of the parts can contain, so no two keys collide.
      const key =
        `${harness}\u0000${modelId}` + (sub ? `\u0000${sub.key}` : "");
      let group = byPair.get(key);
      if (!group) {
        group = {
          modelId,
          harness,
          engineLabel: sub?.label ?? null,
          counts: { flawless: 0, great: 0, passable: 0, scuffed: 0, broken: 0 },
        };
        byPair.set(key, group);
        order.push(key);
      }
      group.counts[scored.rating] += 1;
    }
    return order.map((key) => {
      const { modelId, harness, engineLabel, counts } = byPair.get(key)!;
      return {
        label: pairLabel(labelForModel(modelId), harness, engineLabel),
        counts,
      };
    });
  }, [
    scopedRuns,
    variant,
    findReview,
    localWriteups,
    labelForModel,
    engineSubgroup,
  ]);

  // The points every scored run in scope earned, folded per `(harness, model)`
  // bar: the mean the Points chart plots against, and the points available it is
  // measured out of. A run is scored the same way the Leaderboard scores it
  // (enriched summary card, else local writeup), so the two tabs never disagree
  // about a model's points. The available total is the largest any run in scope
  // was scored out of — versions in scope may declare different checklists, and
  // the fullest of them is the only denominator that fits every bar.
  const points = useMemo(() => {
    const sums = new Map<string, { earned: number; runs: number }>();
    let total = 0;
    for (const run of scopedRuns) {
      const scored = resolveRunScore(run, variant, findReview, localWriteups);
      if (!scored) continue;
      const harness = run.subject.harnessSlug;
      const modelId = canonicalModelId(run.subject.modelId, harness);
      const label = pairLabel(
        labelForModel(modelId),
        harness,
        engineSubgroup?.(run).label ?? null,
      );
      total = Math.max(total, scored.total);
      const acc = sums.get(label) ?? { earned: 0, runs: 0 };
      acc.earned += scored.earned;
      acc.runs += 1;
      sums.set(label, acc);
    }
    const mean = new Map<string, number>();
    for (const [label, acc] of sums) mean.set(label, acc.earned / acc.runs);
    return { mean, total };
  }, [
    scopedRuns,
    variant,
    findReview,
    localWriteups,
    labelForModel,
    engineSubgroup,
  ]);

  // The points a single run earned, for the Points chart's bars. An unscored run
  // (no published score and no local writeup) yields null and is left out of the
  // mean rather than dragging it down with a zero it never earned.
  const pointsValue = useCallback(
    (run: RunSummary): number | null =>
      resolveRunScore(run, variant, findReview, localWriteups)?.earned ?? null,
    [variant, findReview, localWriteups],
  );

  const formatPointsValue = useCallback(
    (value: number): string =>
      points.total > 0
        ? `${formatPoints(value)} / ${points.total} pts`
        : `${formatPoints(value)} pts`,
    [points.total],
  );

  // Splits a `best`-order tie on any chart: the bar whose runs averaged more
  // points wins. Keyed by the bar label the four charts share.
  const tieBreak = useCallback(
    (label: string): number | null => points.mean.get(label) ?? null,
    [points],
  );

  // One order for the whole tab. Every chart renders its own copy of the control
  // bound to this state, so moving any one slider moves all of them — the charts
  // describe one roster and are only comparable while they agree on its order.
  const [sort, setSort] = useState<ChartSort>("alphabetical");
  const sortControl = <ChartSortControl value={sort} onChange={setSort} />;

  // Whether some narrowing is in effect that widening could undo — what decides
  // if the empty state should suggest widening the scope. The controls stay
  // mounted alongside it either way, so a scope that filtered everything away
  // is never a dead end.
  const narrowed =
    (anchoredScope.showVersions && versionScope !== "all") ||
    (multiEngine && !engineWidened);

  return (
    <section className={styles.section}>
      <AnchoredScopeControls
        state={anchoredScope}
        engine={multiEngine ? { name: engineName(engine) } : undefined}
      />

      {/* The case's runs drain over several requests, so a count taken mid-drain
          is meaningless — it would report "not enough runs" about a set that is
          still arriving. Wait for it to settle before judging the sample size. */}
      {loading ? (
        <LoadingState size="section" label="Loading metrics…" />
      ) : scopedRuns.length < MIN_RUNS ? (
        <Panel>
          <p className={styles.empty}>
            {narrowed ? (
              <>
                Need at least {MIN_RUNS} runs of {variant.name} in the selected
                scope to chart a distribution. Widen the scope.
              </>
            ) : (
              <>
                Need at least {MIN_RUNS} runs of {variant.name} to chart a
                distribution.
              </>
            )}
          </p>
        </Panel>
      ) : (
        // One full-width widget per metric, each grouping the scoped runs by model.
        <div className={styles.widgets}>
          <RatingsChartWidget
            title="Ratings"
            models={ratingModels}
            variantName={variant.name}
            sort={sort}
            tieBreak={tieBreak}
            actions={sortControl}
          />
          <MetricChartWidget
            title="Average points"
            runs={scopedRuns}
            subgroup={engineSubgroup}
            value={pointsValue}
            unit="points"
            barMode="meanByModel"
            betterIs="higher"
            colorForModel={colorForModel}
            labelForModel={labelForModel}
            formatValue={formatPointsValue}
            sort={sort}
            tieBreak={tieBreak}
            actions={sortControl}
            empty={`No scored runs of ${variant.name} yet. Points appear once runs have been reviewed.`}
          />
          <MetricChartWidget
            title="Average tokens"
            runs={scopedRuns}
            subgroup={engineSubgroup}
            value={tokensValue}
            unit="tokens"
            yTickFormat={TOKEN_TICKS}
            barMode="meanByModel"
            colorForModel={colorForModel}
            labelForModel={labelForModel}
            formatValue={formatCompact}
            sort={sort}
            tieBreak={tieBreak}
            actions={sortControl}
          />
          <MetricChartWidget
            title="Average cost"
            runs={scopedRuns}
            subgroup={engineSubgroup}
            value={costValue}
            unit="USD"
            barMode="meanByModel"
            colorForModel={colorForModel}
            labelForModel={labelForModel}
            formatValue={formatUsd}
            sort={sort}
            tieBreak={tieBreak}
            actions={sortControl}
          />
        </div>
      )}
    </section>
  );
}
