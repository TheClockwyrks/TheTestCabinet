import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Comparison } from "@clockwyrks/run-record/comparison";
import {
  ChartWidget,
  SectionWidget,
  distributionChart,
  stackedBarChart,
} from "@clockwyrks/ui";
import type { DistributionGroup } from "@clockwyrks/ui";
import type { ComparisonPublishOutcome } from "../../../client/clients";
import { useAuth } from "../../../client/auth";
import {
  useOptionalBackend,
  useOptionalWorkers,
} from "../../../client/context";
import { LoadingState } from "../../components/LoadingState";
import { BackChevron } from "../../components/BackChevron";
import { PageLayout } from "../../components/PageLayout";
import { useGalleryData } from "../../data/galleryContext";
import { useTestCaseName } from "../../data/useTestCaseName";
import { engineName, resolveEngineSlug } from "../../data/engines";
import { useConfirm } from "../../components/ConfirmDialog";
import { GG_HARNESS_SLUG } from "../../data/runLinks";
import { formatCompact, formatUsd } from "../../format";
import { useRunsRuntime } from "../../runtime/runsRuntime";
import { launchBatch } from "../runs/launchBatch";
import { bindModelSlots } from "../runs/gg/ggConfigDraft";
import { useGgConfigs } from "../runs/gg/useGgConfigs";
import { routes } from "../../routes";
import { categoricalColor } from "../../../primitives/plot/palette";
import {
  appendRunIds,
  armTopUps,
  harnessArmLaunchItems,
  countedRunIds,
  isGgArm,
  medianRatio,
  pruneDeadRunIds,
  toolCallChartData,
  totalMissingRuns,
  withArmRunIds,
} from "./comparisonMath";
import { SubmitNotice } from "../../components/SubmitNotice";
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
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  // A published comparison is public, so this page renders on the static site as
  // well — and that host mounts neither client provider. Both are read
  // optionally: the run/publish affordances below already gate on `canExecute`
  // and on the client being able to do the thing, so their absence is a
  // read-only page rather than a failed one.
  const backend = useOptionalBackend()?.client ?? null;
  const { canExecute, readComparison } = useGalleryData();
  const worker = useOptionalWorkers()?.active ?? null;
  const runtime = useRunsRuntime();
  const testCaseName = useTestCaseName();
  // Both the shared built-ins and the account's own, since an arm may name
  // either (its `ggConfigId` is the launcher's key for one).
  const { options: ggOptions } = useGgConfigs();

  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [publishResult, setPublishResult] =
    useState<ComparisonPublishOutcome | null>(null);

  useEffect(() => {
    // A signed-in console fetches the account's comparison from the backend. A
    // read-only host (the static site) resolves the published comparison from the
    // gallery snapshot instead — no token, no fetch.
    if (backend?.getComparison && token) {
      let active = true;
      setLoading(true);
      setError(null);
      backend
        .getComparison(id, token)
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
    }
    if (readComparison) {
      setComparison(readComparison(id));
      setError(null);
    }
    setLoading(false);
  }, [backend, token, id, readComparison]);

  const canTrigger = Boolean(worker && (worker.local || token));

  const triggerMissing = useCallback(async () => {
    if (!comparison || !worker || !canTrigger) return;
    setTriggering(true);
    setError(null);
    try {
      // Every id the arms record that no longer names a live run is dropped before
      // anything is launched, so the top-up counts what actually exists and the
      // config written back below stops carrying the dead ones (docs/comparisons/
      // experiments.md, "Triggering the runs").
      let nextConfig = pruneDeadRunIds(comparison.config, comparison.arms);
      const { controls } = nextConfig;
      for (const { arm, remaining } of armTopUps(nextConfig, comparison.arms)) {
        if (remaining <= 0) continue;

        // A gg arm launches through gg's own endpoint (one request per run, each
        // isolated so one failure never aborts the rest) with the arm's slot
        // models bound onto the configuration it names; a harness arm goes
        // through the shared batch path. The two reconcile into the one arm's
        // run ids.
        if (isGgArm(arm)) {
          const option = ggOptions.find((o) => o.key === arm.ggConfigId);
          if (!option) {
            setError(
              `The gg configuration behind "${arm.label}" is no longer available, so its runs were skipped.`,
            );
            continue;
          }
          const capabilitySet = bindModelSlots(
            option.capabilitySet,
            arm.ggSlotModels ?? {},
          );
          const results: { runId?: string; error?: string }[] = [];
          for (let i = 0; i < remaining; i++) {
            try {
              const ack = await worker.client.launchGgRun(
                {
                  testCase: controls.caseSlug,
                  version: controls.version,
                  variant: controls.variant,
                  capabilitySet,
                  // The engine is one of the comparison's held-constant controls.
                  // A gg arm launched engineless while the comparison declares an
                  // engine would be doing different work from the harness arm it
                  // is being compared against — confounding the experiment
                  // against its own control.
                  engine: resolveEngineSlug(controls.engineSlug),
                },
                token ?? "",
              );
              runtime.track({
                testCaseSlug: controls.caseSlug,
                testCaseVersion: controls.version,
                variant: controls.variant,
                harnessSlug: GG_HARNESS_SLUG,
                // The run's representative model is its root agent's, which is what
                // the backend lifts into the job's launch identity.
                modelId: capabilitySet.agents?.[0]?.modelId ?? "",
                // What the Runs page actually shows for a gg run: the configuration
                // it was launched from, read off the set that was sent rather than
                // the picker option, so it is byte-identical to the name the backend
                // lifts back out of the stored capability set. Without it the row
                // would fall back to the root agent's model for its whole in-flight
                // life — the reconcile only patches `state` on rows it already
                // tracks, so nothing re-seeds this one until a reload.
                ggPreset: capabilitySet.preset ?? null,
                engine: resolveEngineSlug(controls.engineSlug),
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
          const launched = await launchBatch(
            worker,
            token,
            runtime.track,
            harnessArmLaunchItems(controls, arm, remaining),
          );
          nextConfig = withArmRunIds(
            nextConfig,
            arm.id,
            appendRunIds(arm.runIds, launched),
          );
        }
      }
      if (backend?.updateComparison && token) {
        // Written back even when nothing was launched: the prune above is itself a
        // change worth keeping, and the response is the re-aggregated comparison —
        // which is how the page learns what its arms' live runs now are.
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
  }, [comparison, worker, canTrigger, ggOptions, token, runtime, backend]);

  const canDelete = Boolean(canExecute && token && backend?.deleteComparison);

  // Deleting the comparison discards the experiment, never its runs: the runs it
  // launched are ordinary runs and stay exactly where they are (the backend's
  // `DELETE /comparisons/{id}` touches nothing else). The dialog says so, because
  // "delete this comparison" otherwise reads as "delete all those runs".
  const onDelete = useCallback(async () => {
    if (!comparison || !backend?.deleteComparison || !token) return;
    const confirmed = await confirm({
      title: "Delete comparison",
      message: (
        <>
          Delete <strong>{comparison.name}</strong>? Its configuration and every
          figure computed from it are removed. The runs it launched are ordinary
          runs and are <strong>not</strong> deleted. This cannot be undone.
        </>
      ),
      confirmLabel: "Delete comparison",
    });
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      await backend.deleteComparison(comparison.id, token);
      // Gone: leave for the list rather than sitting on a page whose subject no
      // longer exists, and replace the entry so Back does not return to it.
      navigate(routes.runsComparisons(), { replace: true });
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  }, [comparison, backend, token, confirm, navigate]);

  const onPublish = useCallback(async () => {
    if (!comparison || !backend?.publishComparison || !token) return;
    setPublishing(true);
    setError(null);
    try {
      // The publish endpoint reports which arm runs were enqueued/skipped, not
      // the updated comparison (publishing a run is a real pod/repo/deploy, so
      // it is always best-effort and selective — see docs/comparisons/
      // publishing.md). Flip `published` locally rather than guessing at a
      // round-trip; a reload always shows the authoritative state.
      const outcome = await backend.publishComparison(comparison.id, token);
      setPublishResult(outcome);
      setComparison((prev) => (prev ? { ...prev, published: true } : prev));
    } catch (e) {
      setError(String(e));
    } finally {
      setPublishing(false);
    }
  }, [comparison, backend, token]);

  // What "Trigger missing runs" would launch right now: per arm, `N` less the runs
  // it records that still exist. An arm whose runs were deleted is short again, and
  // says so — the whole point of counting live ids rather than every id ever
  // launched.
  const totalMissing = useMemo(
    () =>
      comparison ? totalMissingRuns(comparison.config, comparison.arms) : 0,
    [comparison],
  );

  // A console needs a signed-in account (comparisons are per-account); a read-only
  // host (the static site) renders the published comparison with no sign-in.
  if (canExecute && !token) {
    return (
      <PageLayout>
        <header className={styles.detailHeader}>
          <div className={styles.detailTitleRow}>
            <BackChevron
              to={routes.runsComparisons()}
              label="All comparisons"
            />
            <h1 className={styles.detailTitle}>Comparison</h1>
          </div>
        </header>
        <p className={`${exec.notice} ${exec.warn}`}>
          Sign in to view a comparison. Comparisons are saved to your account.
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
              to={routes.runsComparisons()}
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
  const engineSlug = resolveEngineSlug(controls.engineSlug);

  // Why the trigger button is doing nothing, in the button's own tooltip. Each
  // case is a different fix — connect a worker, or there is genuinely nothing
  // missing — so a single disabled button with no explanation would leave an
  // operator guessing (report: "there's now no ability to trigger").
  const triggerHint = !canTrigger
    ? "Connect a worker (the gear in the top bar) to trigger runs."
    : totalMissing === 0
      ? `Every configuration already has ${comparison.config.n} live run${
          comparison.config.n === 1 ? "" : "s"
        }. Runs deleted since they were launched stop counting, and are offered here again.`
      : `Launch the ${totalMissing} run${totalMissing === 1 ? "" : "s"} the configurations are still short of N=${comparison.config.n}.`;

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
          <BackChevron to={routes.runsComparisons()} label="All comparisons" />
          <h1 className={styles.detailTitle}>{comparison.name}</h1>
          {comparison.published && (
            <span className={styles.publishedBadge}>Published</span>
          )}
        </div>
        {/* Every action here mutates a per-account comparison, so the whole bar is
            console-only — the read-only static site (canExecute false) renders the
            comparison without it. */}
        {canExecute && (
          <div className={styles.detailActions}>
            {/* Always shown, never hidden when it has nothing to do: an operator
                who deleted an arm's runs and came back to relaunch them needs to
                see *why* the button offers nothing, not an empty toolbar. Its
                title names the one reason it is disabled. */}
            <button
              type="button"
              className={exec.primary}
              disabled={triggering || !canTrigger || totalMissing === 0}
              title={triggerHint}
              onClick={triggerMissing}
            >
              {triggering
                ? "Triggering…"
                : totalMissing > 0
                  ? `Trigger missing runs (${totalMissing})`
                  : "Trigger missing runs"}
            </button>
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
            {canDelete && (
              <button
                type="button"
                className={exec.danger}
                disabled={deleting}
                onClick={onDelete}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
        )}
      </header>

      {comparison.description && (
        <p className={styles.description}>{comparison.description}</p>
      )}
      <SubmitNotice message={error} />
      {publishResult && (
        <p className={`${exec.notice} ${exec.warn}`}>
          Published. {publishResult.enqueued.length} run
          {publishResult.enqueued.length === 1 ? "" : "s"} enqueued for
          publishing.
          {publishResult.skipped.length > 0 && (
            <>
              {" "}
              {publishResult.skipped.length} run
              {publishResult.skipped.length === 1 ? "" : "s"} skipped:{" "}
              {publishResult.skipped
                .map((s) => `${s.runId} (${s.reason})`)
                .join(", ")}
              {". "}
              This comparison is only partially published.
            </>
          )}
        </p>
      )}
      {canExecute && !canTrigger && totalMissing > 0 && (
        <p className={`${exec.notice} ${exec.warn}`}>
          No worker connected. Open the connections drawer (the gear in the top
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
        <div className={styles.controlStat}>
          <span className={styles.controlStatLabel}>Configurations</span>
          <span className={styles.controlStatValue}>
            {comparison.config.arms.length}
          </span>
        </div>
        <div className={styles.controlStat}>
          <span className={styles.controlStatLabel}>Engine</span>
          <span className={styles.controlStatValue}>
            {engineName(engineSlug)}
          </span>
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
            <p key={i} className={styles.confoundNote}>
              <strong>{armLabel}</strong>: {confound.variable} varied across
              this arm&rsquo;s runs as {confound.values.join(", ")}. This
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

      {/* Every figure on this page is a widget in one column, and the column is
          the only thing that spaces them. A section that sets its own margins
          (as the score section used to) reads as a different kind of thing: the
          gaps around it stop matching the gaps between the charts, and its title
          ends up out on the backdrop while every other title sits in a panel. */}
      <div className={styles.sections}>
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

        {/* A peer of the three charts rather than a hand-rolled section: same
            panel, same header treatment, same place in the column's rhythm. */}
        <SectionWidget
          title="Score & pass rate"
          hint="The automated-only score across each arm's runs — every run's own point beside the mean — and the pass rate with its Wilson 95% interval."
        >
          <div className={styles.armRows}>
            {arms.map((a) => {
              // Runs this arm launched that exist but whose record has not landed
              // yet. Stated rather than left as a silent gap between the arm's `n`
              // and its desired count, which otherwise reads as runs that were
              // never launched at all. Counted off the same ids the top-up
              // counts (`countedRunIds`), so the two figures can never disagree —
              // including against a backend that reports no liveness at all,
              // where both fall back to what the arm itself records.
              const inFlight = Math.max(
                0,
                countedRunIds(a).length - a.nObserved,
              );
              return (
                <div key={a.arm.id} className={styles.armRow}>
                  <div className={styles.armRowHead}>
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
                      {inFlight > 0 && ` · ${inFlight} still in flight`}
                    </span>
                  </div>
                  {a.score ? (
                    <div className={styles.scoreRow}>
                      <span className={styles.scoreMean}>
                        {Math.round(a.score.meanFraction * 100)}% avg
                        (automated-only)
                      </span>
                      {a.score.points.map((p, i) => (
                        <span key={i} className={styles.scorePoint}>
                          {p.earned}/{p.total}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.armEmpty}>No scored runs yet.</p>
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
                        {Math.round(a.passRate.rate * 100)}%), Wilson{" "}
                        {Math.round(a.passRate.wilsonLow * 100)}%–
                        {Math.round(a.passRate.wilsonHigh * 100)}%
                      </span>
                    </div>
                  ) : (
                    <p className={styles.armEmpty}>No pass-rate data yet.</p>
                  )}
                </div>
              );
            })}
          </div>
        </SectionWidget>

        <ChartWidget
          title="Tool-call diagnostics"
          chartTitle="Tool calls by arm, including consumed tools"
          hint="Includes recognized-but-consumed tool calls (e.g. todo tools) that emit no workspace event but still cost real API round-trips, which is often the why behind a cost gap."
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
      </div>
    </PageLayout>
  );
}
