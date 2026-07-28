import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { Comparison } from "@test-cabinet/run-record/comparison";
import {
  ChartWidget,
  distributionChart,
  stackedBarChart,
} from "@test-cabinet/ui";
import type { DistributionGroup } from "@test-cabinet/ui";
import { useAuth } from "../../../client/auth";
import { useBackend, useWorkers } from "../../../client/context";
import { LoadingState } from "../../components/LoadingState";
import { BackChevron } from "../../components/BackChevron";
import { PageLayout } from "../../components/PageLayout";
import { useTestCaseName } from "../../data/useTestCaseName";
import { formatCompact, formatUsd } from "../../format";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { launchBatch } from "../runs/launchBatch";
import { useGgConfigs } from "../runs/gg/useGgConfigs";
import { routes } from "../../routes";
import { categoricalColor } from "./armColors";
import {
  appendRunIds,
  harnessArmLaunchItems,
  medianRatio,
  modelArmLaunchItems,
  remainingForArm,
  toolCallChartData,
  withArmRunIds,
} from "./comparisonMath";
import exec from "../runs/RunExec.module.scss";
import styles from "./Comparisons.module.scss";

// The comparison detail page (`/comparisons/:id`) — the heart of the feature.
// Per arm it presents the cost/token distribution (a box + whiskers + bootstrap
// CI over the arm's runs — never a single averaged bar, and never merged across
// arms), the automated-only score, the pass rate with its Wilson interval, and
// the tool-call diagnostics that explain *why* one arm costs more. Any confound
// is surfaced as a visible warning, never silently folded in. Console-only;
// gated on a signed-in account (a comparison is per-account, like a coverage
// plan). See docs/comparisons/{experiments,statistics,diagnostics}.md — the two
// hard rules this page must never violate: never merge harnesses (each arm is
// its own series, always labeled with its own `n`), and present data, never
// declare a winner (no "best", no significance badge).
export function ComparisonDetailPage() {
  const { id = "" } = useParams();
  const { token } = useAuth();
  const { client: backend } = useBackend();
  const { active: worker } = useWorkers();
  const runtime = useRunsRuntime();
  const testCaseName = useTestCaseName();
  const { saved: ggConfigs } = useGgConfigs();

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!backend || !token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    backend
      .getComparison?.(id, token)
      .then((c) => {
        if (!active) return;
        setComparison(c ?? null);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [backend, token, id]);

  const canTrigger = Boolean(worker && (worker.local || token));

  // The harness pinned across every model arm (see ComparisonEditPage's module
  // doc): read back off any arm, since every model arm carries the same one.
  const pinnedHarness = useMemo(
    () => comparison?.config.arms.find((a) => a.harnessSlug)?.harnessSlug ?? "",
    [comparison],
  );

  const triggerMissing = useCallback(async () => {
    if (!comparison || !worker || !canTrigger) return;
    setTriggering(true);
    setError(null);
    try {
      let nextConfig = comparison.config;
      for (const arm of comparison.config.arms) {
        const remaining = remainingForArm(comparison.config.n, arm);
        if (remaining <= 0) continue;

        if (comparison.config.varied === "gg_config") {
          const ggConfig = ggConfigs.find((c) => c.id === arm.ggConfigId);
          if (!ggConfig) continue;
          const results: { runId?: string; error?: string }[] = [];
          for (let i = 0; i < remaining; i++) {
            try {
              const ack = await worker.client.launchGgRun(
                {
                  testCase: comparison.config.controls.caseSlug,
                  version: comparison.config.controls.version,
                  variant: comparison.config.controls.variant,
                  capabilitySet: ggConfig.capabilitySet,
                },
                token ?? "",
              );
              runtime.track({
                testCaseSlug: comparison.config.controls.caseSlug,
                testCaseVersion: comparison.config.controls.version,
                variant: comparison.config.controls.variant,
                harnessSlug: "gg",
                modelId: ggConfig.name,
                runId: ack.jobId,
                state: "queued",
              });
              results.push({ runId: ack.jobId });
            } catch (e) {
              results.push({ error: String(e) });
            }
          }
          nextConfig = withArmRunIds(
            nextConfig,
            arm.id,
            appendRunIds(arm.runIds, results),
          );
        } else {
          const items =
            comparison.config.varied === "harness"
              ? harnessArmLaunchItems(
                  comparison.config.controls,
                  arm,
                  remaining,
                )
              : modelArmLaunchItems(
                  comparison.config.controls,
                  pinnedHarness,
                  arm,
                  remaining,
                );
          const launched = await launchBatch(
            worker,
            token,
            runtime.track,
            items,
          );
          nextConfig = withArmRunIds(
            nextConfig,
            arm.id,
            appendRunIds(arm.runIds, launched),
          );
        }
      }
      if (backend?.updateComparison && token) {
        const updated = await backend.updateComparison(
          comparison.id,
          {
            name: comparison.name,
            description: comparison.description,
            config: nextConfig,
          },
          token,
        );
        setComparison(updated);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setTriggering(false);
    }
  }, [
    comparison,
    worker,
    canTrigger,
    ggConfigs,
    pinnedHarness,
    token,
    runtime,
    backend,
  ]);

  const onPublish = useCallback(async () => {
    if (!comparison || !backend?.publishComparison || !token) return;
    setPublishing(true);
    setError(null);
    try {
      const updated = await backend.publishComparison(comparison.id, token);
      setComparison(updated);
    } catch (e) {
      setError(String(e));
    } finally {
      setPublishing(false);
    }
  }, [comparison, backend, token]);

  const totalMissing = useMemo(
    () =>
      comparison
        ? comparison.config.arms.reduce(
            (sum, arm) => sum + remainingForArm(comparison.config.n, arm),
            0,
          )
        : 0,
    [comparison],
  );

  if (!token) {
    return (
      <PageLayout>
        <header className={styles.detailHeader}>
          <div className={styles.detailTitleRow}>
            <BackChevron
              to={routes.otherComparisons()}
              label="All comparisons"
            />
            <h1 className={styles.detailTitle}>Comparison</h1>
          </div>
        </header>
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to view a comparison — comparisons are saved to your account.
        </p>
      </PageLayout>
    );
  }

  if (loading) {
    return (
      <PageLayout>
        <LoadingState label="Loading comparison…" />
      </PageLayout>
    );
  }

  if (!comparison) {
    return (
      <PageLayout>
        <header className={styles.detailHeader}>
          <div className={styles.detailTitleRow}>
            <BackChevron
              to={routes.otherComparisons()}
              label="All comparisons"
            />
            <h1 className={styles.detailTitle}>Comparison</h1>
          </div>
        </header>
        <p className={`${exec.notice} ${exec.error}`}>
          {error ?? "That comparison no longer exists."}
        </p>
      </PageLayout>
    );
  }

  const { controls } = comparison.config;
  const arms = comparison.arms;

  // The color assigned to each arm, by its position in the config's arm order —
  // fixed and never re-cycled, matching the arm order everywhere on this page
  // (the charts, the panels, the trigger loop).
  const colorForArm = new Map(
    comparison.config.arms.map((arm, i) => [arm.id, categoricalColor(i)]),
  );

  const costGroups: DistributionGroup[] = arms
    .filter((a) => a.cost)
    .map((a) => ({
      label: a.arm.label,
      color: colorForArm.get(a.arm.id),
      n: a.cost!.n,
      points: [],
      median: a.cost!.median,
      mean: a.cost!.mean,
      min: a.cost!.min,
      max: a.cost!.max,
      q1: a.cost!.q1,
      q3: a.cost!.q3,
      ciLow: a.cost!.ciLow,
      ciHigh: a.cost!.ciHigh,
    }));
  const tokenGroups: DistributionGroup[] = arms
    .filter((a) => a.tokens)
    .map((a) => ({
      label: a.arm.label,
      color: colorForArm.get(a.arm.id),
      n: a.tokens!.n,
      points: [],
      median: a.tokens!.median,
      mean: a.tokens!.mean,
      min: a.tokens!.min,
      max: a.tokens!.max,
      q1: a.tokens!.q1,
      q3: a.tokens!.q3,
      ciLow: a.tokens!.ciLow,
      ciHigh: a.tokens!.ciHigh,
    }));

  const toolCallData = toolCallChartData(
    arms.map((a) => ({
      armLabel: a.arm.label,
      toolCalls: a.diagnostics.toolCalls ?? {},
    })),
  );

  // Every confound any arm carries, flattened with its arm's label — a
  // comparison whose arms aren't truly comparable is worse than no comparison
  // (docs/comparisons/experiments.md), so this is shown loudly, never folded in.
  const confounds = arms.flatMap((a) =>
    (a.confounds ?? []).map((c) => ({ armLabel: a.arm.label, confound: c })),
  );

  // The presented (never a verdict) median-cost ratio for exactly two arms, both
  // with a resolved cost distribution — "arm's median cost is ~R× the other's"
  // (docs/comparisons/statistics.md). Ordered so the ratio reads >= 1.
  const costPair: [(typeof arms)[number], (typeof arms)[number]] | null =
    arms.length === 2 && arms[0]!.cost && arms[1]!.cost
      ? ([arms[0]!, arms[1]!].sort(
          (x, y) => y.cost!.median - x.cost!.median,
        ) as [(typeof arms)[number], (typeof arms)[number]])
      : null;
  const [hi, lo] = costPair ?? [null, null];
  const costRatio =
    hi && lo ? medianRatio(hi.cost!.median, lo.cost!.median) : null;

  return (
    <PageLayout>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <BackChevron to={routes.otherComparisons()} label="All comparisons" />
          <h1 className={styles.detailTitle}>{comparison.name}</h1>
          {comparison.published && (
            <span className={styles.publishedBadge}>Published</span>
          )}
        </div>
        <div className={styles.detailActions}>
          {canTrigger && totalMissing > 0 && (
            <button
              type="button"
              className={exec.primary}
              disabled={triggering}
              onClick={triggerMissing}
            >
              {triggering
                ? "Triggering…"
                : `Trigger missing runs (${totalMissing})`}
            </button>
          )}
          <Link
            className={exec.secondary}
            to={routes.comparisonEdit(comparison.id)}
          >
            Edit
          </Link>
          {backend?.publishComparison && !comparison.published && (
            <button
              type="button"
              className={exec.secondary}
              disabled={publishing}
              onClick={onPublish}
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          )}
        </div>
      </header>

      {comparison.description && (
        <p className={styles.empty}>{comparison.description}</p>
      )}
      {error && <p className={`${exec.notice} ${exec.error}`}>{error}</p>}
      {!canTrigger && totalMissing > 0 && (
        <p className={`${exec.notice} ${exec.warn}`}>
          No worker connected — open the connections drawer (the gear in the top
          bar) to add a worker before triggering the {totalMissing} still-
          missing run{totalMissing === 1 ? "" : "s"}.
        </p>
      )}

      <div className={styles.controlsStrip}>
        <div className={styles.controlStat}>
          <span className={styles.controlStatLabel}>Case</span>
          <span className={styles.controlStatValue}>
            {testCaseName(controls.caseSlug)} · {controls.variant} ·{" "}
            {controls.version}
          </span>
        </div>
        {controls.modelId && (
          <div className={styles.controlStat}>
            <span className={styles.controlStatLabel}>Model</span>
            <span className={styles.controlStatValue}>{controls.modelId}</span>
          </div>
        )}
        <div className={styles.controlStat}>
          <span className={styles.controlStatLabel}>Auth mode</span>
          <span className={styles.controlStatValue}>{controls.authMode}</span>
        </div>
        <div className={styles.controlStat}>
          <span className={styles.controlStatLabel}>Orchestrator</span>
          <span className={styles.controlStatValue}>
            {controls.orchestratorSlug}
          </span>
        </div>
        <div className={styles.controlStat}>
          <span className={styles.controlStatLabel}>N per arm</span>
          <span className={styles.controlStatValue}>{comparison.config.n}</span>
        </div>
      </div>

      {confounds.length > 0 && (
        <div className={styles.confoundBanner}>
          <span className={styles.confoundTitle}>
            Confound{confounds.length === 1 ? "" : "s"} detected
          </span>
          {confounds.map(({ armLabel, confound }, i) => (
            <p key={i}>
              <strong>{armLabel}</strong>: {confound.variable} varied across
              this arm&rsquo;s runs — {confound.values.join(", ")}. This
              arm&rsquo;s runs are not a clean comparison against the others.
            </p>
          ))}
        </div>
      )}

      {costRatio !== null && !Number.isNaN(costRatio) && hi && lo && (
        <p className={styles.ratioCallout}>
          {hi.arm.label}&rsquo;s median cost is ~{costRatio.toFixed(1)}×{" "}
          {lo.arm.label}
          &rsquo;s ({formatUsd(hi.cost!.median)} vs {formatUsd(lo.cost!.median)}
          ).
        </p>
      )}

      <ChartWidget
        title="Cost"
        chartTitle="Comparable cost distribution by arm"
        hint="Box = IQR, whiskers = min/max, tick = median, thin band = bootstrap 95% CI on the median. Every arm keeps its own n."
        spec={
          costGroups.length === 0
            ? undefined
            : (palette) =>
                distributionChart(costGroups, palette, {
                  y: "USD",
                  formatValue: (v) => formatUsd(v),
                })
        }
        empty="No cost data yet for this comparison's runs."
      />

      <ChartWidget
        title="Tokens"
        chartTitle="Total token distribution by arm"
        hint="Box = IQR, whiskers = min/max, tick = median, thin band = bootstrap 95% CI on the median. Every arm keeps its own n."
        spec={
          tokenGroups.length === 0
            ? undefined
            : (palette) =>
                distributionChart(tokenGroups, palette, {
                  y: "tokens",
                  yTickFormat: "~s",
                  formatValue: formatCompact,
                })
        }
        empty="No token data yet for this comparison's runs."
      />

      <section className={styles.armSection}>
        <h2 className={styles.armSectionTitle}>Score &amp; pass rate</h2>
        {arms.map((a) => (
          <div key={a.arm.id} className={styles.armPanel}>
            <div className={styles.armPanelHead}>
              <span className={styles.armLabel}>
                <span
                  className={styles.armSwatch}
                  style={{ background: colorForArm.get(a.arm.id) }}
                  aria-hidden
                />
                {a.arm.label}
              </span>
              <span className={styles.armN}>
                n={a.nObserved} of {a.nDesired} desired
              </span>
            </div>
            {a.score ? (
              <div className={styles.scoreRow}>
                <span className={styles.scoreMean}>
                  {Math.round(a.score.meanFraction * 100)}% avg (automated-only)
                </span>
                {a.score.points.map((p, i) => (
                  <span key={i} className={styles.scorePoint}>
                    {p.earned}/{p.total}
                  </span>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>No scored runs yet.</p>
            )}
            {a.passRate ? (
              <div className={styles.meterRow}>
                <div className={styles.meter}>
                  <span
                    className={styles.meterFill}
                    style={{ width: `${a.passRate.rate * 100}%` }}
                  />
                  <span
                    className={styles.meterInterval}
                    style={{
                      left: `${a.passRate.wilsonLow * 100}%`,
                      width: `${(a.passRate.wilsonHigh - a.passRate.wilsonLow) * 100}%`,
                    }}
                  />
                </div>
                <span className={styles.meterLabel}>
                  {a.passRate.passed}/{a.passRate.n} passed (
                  {Math.round(a.passRate.rate * 100)}%) — Wilson{" "}
                  {Math.round(a.passRate.wilsonLow * 100)}%–
                  {Math.round(a.passRate.wilsonHigh * 100)}%
                </span>
              </div>
            ) : (
              <p className={styles.empty}>No pass-rate data yet.</p>
            )}
          </div>
        ))}
      </section>

      <ChartWidget
        title="Tool-call diagnostics"
        chartTitle="Tool calls by arm, including consumed tools"
        hint="Includes recognized-but-consumed tool calls (e.g. todo tools) that emit no workspace event but still cost real API round-trips — the why behind a cost gap."
        spec={
          toolCallData.segments.length === 0
            ? undefined
            : (palette) =>
                stackedBarChart(
                  toolCallData.segments,
                  palette,
                  toolCallData.series,
                  {
                    y: "tool calls",
                  },
                )
        }
        empty="No tool-call diagnostics recorded yet for this comparison's runs."
      />
    </PageLayout>
  );
}
