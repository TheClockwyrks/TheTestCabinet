import { useMemo } from "react";
import { MetricTile, Panel } from "@test-cabinet/ui";
import type { PerformanceResult, RunRecord } from "@test-cabinet/run-record";
import { formatInteger } from "../../../format";
import { useCaseRunSummaries } from "../../../data/useRuns";
import { useFindModel } from "../../../data/useModels";
import { perModelBestFuel, placeRunFuel } from "../../../data/fuelRanking";
import { canonicalModelId } from "../../../../modelId";
import styles from "./RunDetailPages.module.scss";

// Below this many distinct models a percentage reads as noise ("better than 100%
// of 1 other model"), so the panel shows the raw rank instead.
const MIN_FIELD_FOR_PERCENTILE = 5;

/**
 * How far an over-ceiling scenario's fuel ran past the pass line, e.g. "26% over
 * the 5,000,000,000 fuel ceiling". A scored run always carries its pass line, so
 * the null case (a run with no scored ceiling at all) has no over-ceiling scenarios
 * to describe — it only exists to satisfy the type.
 */
function overshootDetail(fuel: number, fuelLimit: number | null): string {
  if (fuelLimit === null || fuelLimit <= 0) {
    return `correct, but ${formatInteger(fuel)} fuel — over the ceiling`;
  }
  const pct = Math.round(((fuel - fuelLimit) / fuelLimit) * 100);
  return `correct, but ${pct}% over the ${formatInteger(fuelLimit)} fuel ceiling`;
}

/**
 * The correctness-and-fuel result of a performance run — the whole body of that
 * run's Results tab (`/runs/:runId`). A performance run is graded automatically
 * and carries no human review, so this auto-scored result stands where a reviewed
 * run shows its verdict. It leads with the correctness gate and the
 * total-fuel score, then breaks the run down per held-out scenario: whether each
 * reproduced the reference oracle's state and the fuel it burned, with the first
 * diverging snapshot tick (or a failure detail) for an incorrect one.
 *
 * A performance run's authoritative signal is correctness plus fuel — lower is
 * better — and fuel is only meaningful once the engine is correct (a fast wrong
 * answer is no answer), so the total reads as an em dash for an incorrect run.
 * There is no replay renderer in performance v1; this numeric result is the whole
 * evidence of the run.
 *
 * Renders nothing for a non-performance run (its `validation.performance` is
 * absent), so it is safe to mount unconditionally alongside the other result
 * sections.
 */
export function PerformanceResultSection({ run }: { run: RunRecord }) {
  const performance = run.validation.performance;
  if (!performance) return null;
  return (
    <>
      <PerformanceResultBody result={performance} />
      {/* A run earns a placement only once it is correct with a fuel number; a
          failed run has no comparable result to rank. Mounted separately from the
          pure body so it, not the body, owns the case-scoped data fetch. */}
      {performance.correct && performance.totalFuel !== null ? (
        <PerformanceRankPanel run={run} fuel={performance.totalFuel} />
      ) : null}
    </>
  );
}

/**
 * Where this run's fuel lands among every model's best effort on the same case,
 * version, and variant — a per-model-best leaderboard placement and percentile,
 * so an isolated fuel number gains shape without leaving the run. Fuel is only
 * comparable within one scored scenario set, so the field is scoped to the run's
 * exact `(slug, version, variant)`. The board folds each model to its best run,
 * but THIS run is placed as itself, so a worse duplicate still sees its standing —
 * including against its own model's recorded best.
 */
function PerformanceRankPanel({ run, fuel }: { run: RunRecord; fuel: number }) {
  const { summaries, loading } = useCaseRunSummaries(run.subject.testCaseSlug);
  const findModel = useFindModel();

  const placement = useMemo(() => {
    const entries = perModelBestFuel(
      summaries,
      {
        slug: run.subject.testCaseSlug,
        version: run.subject.testCaseVersion,
        variant: run.subject.variant,
      },
      (id, harness) => findModel(id, harness)?.name ?? id,
    );
    const modelId = canonicalModelId(
      run.subject.modelId,
      run.subject.harnessSlug,
    );
    return placeRunFuel(fuel, modelId, entries);
  }, [summaries, run.subject, fuel, findModel]);

  // Nothing to compare against yet (no other correct run of this scenario set),
  // or the field is still loading. Either way there is no meaningful standing to
  // show, so the panel stays quiet rather than asserting "#1 of 1".
  if (loading || !placement) return null;

  const { rank, fieldSize, percentileBeaten, isModelBest, modelBestFuel } =
    placement;
  const showPercentile =
    percentileBeaten !== null && fieldSize >= MIN_FIELD_FOR_PERCENTILE;

  return (
    <Panel>
      <h2 className={`${styles.section} ${styles.leadHeading}`}>Standing</h2>
      <p className={styles.secondary}>
        How this run's fuel compares to every model's best correct run of this
        scenario set (lower fuel is better; each model counts once, at its best).
      </p>
      <div className={`${styles.metricRow} ${styles.cols2}`}>
        <MetricTile
          label="Leaderboard rank"
          value={`#${rank} of ${fieldSize} ${
            fieldSize === 1 ? "model" : "models"
          }`}
          title="This run's total fuel ranked against every model's best correct run of the same case, version, and variant."
        />
        {showPercentile ? (
          <MetricTile
            label="Efficiency percentile"
            value={`Beats ${Math.round(percentileBeaten * 100)}% of models`}
            title="The share of other models whose best correct run this run's fuel beats."
          />
        ) : (
          <MetricTile
            label="Field"
            value={`${fieldSize} ${fieldSize === 1 ? "model" : "models"} ranked`}
            title="How many distinct models have a correct run of this scenario set — too few for a meaningful percentile yet."
          />
        )}
      </div>
      {!isModelBest ? (
        <p className={styles.secondary}>
          This model already has a more efficient run of this scenario set (best:{" "}
          {formatInteger(modelBestFuel)} fuel), so this run is a slower duplicate
          — it does not change the model's leaderboard position.
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * The pure render of a resolved {@link PerformanceResult}, split out from the
 * run-reading wrapper so it can be exercised directly with a hand-built result.
 */
export function PerformanceResultBody({
  result,
}: {
  result: PerformanceResult;
}) {
  const { correct, totalFuel, fuelLimit, cases, detail } = result;
  const total = cases.length;
  const correctCount = cases.filter((scenario) => scenario.correct).length;
  // Correct-but-over-the-ceiling scenarios: they reproduced the state, so they are
  // not wrong, but they burned past the fuel limit on the case's runway. Called out
  // because that is exactly the "how far over" signal the runway exists to capture.
  const overCount = cases.filter((scenario) => scenario.overCeiling).length;

  return (
    <Panel>
      <h2 className={`${styles.section} ${styles.leadHeading}`}>
        Performance result
      </h2>

      {/* The gate that decides everything: correctness is all-or-nothing across
          the held-out set, so lead with the pass/fail AND the scenario tally —
          "Fail" alone doesn't say whether the engine missed one scenario or all of
          them, and the fuel score only means anything once every scenario passes. */}
      <p className={correct ? styles.loaded : styles.notLoaded}>
        {correct
          ? `Correct — all ${total} held-out ${
              total === 1 ? "scenario" : "scenarios"
            } reproduced the reference oracle's exact state.`
          : total > 0
            ? `Incorrect — ${correctCount} of ${total} ${
                total === 1 ? "scenario" : "scenarios"
              } passed within the fuel ceiling; a run earns a fuel score only when every one does.${
                overCount > 0
                  ? ` ${overCount} produced the correct answer but ran over the ceiling — see how far over below.`
                  : ""
              }`
            : "Incorrect — this run produced no scored result."}
      </p>

      {/* Correctness gate + the fuel score. Fuel is only meaningful for a correct
          engine, so it is an em dash otherwise. */}
      <div className={`${styles.metricRow} ${styles.cols2}`}>
        <MetricTile label="Correctness" value={correct ? "Pass" : "Fail"} />
        <MetricTile
          label="Total fuel"
          value={totalFuel === null ? "—" : formatInteger(totalFuel)}
          title="Lower is better — the fuel a correct engine consumed across every held-out scenario."
        />
      </div>

      <p className={styles.secondary}>
        Correctness is a gate: only a correct engine earns a fuel score, and
        lower fuel is better. The breakdown below is per held-out scenario.
      </p>

      {/* Per-scenario breakdown: which scenarios reproduced the oracle's state,
          the fuel each burned (kept even when incorrect, for diagnostics), and —
          for an incorrect scenario — where it first diverged or why it could not
          be scored. */}
      <table className={styles.checks}>
        <thead>
          <tr>
            <th scope="col">Scenario</th>
            <th scope="col">Result</th>
            <th scope="col">Fuel</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((scenario) => (
            <tr key={scenario.input}>
              <th scope="row" className={styles.checkName}>
                {scenario.input}
              </th>
              <td
                className={
                  scenario.correct
                    ? styles.loaded
                    : scenario.overCeiling
                      ? styles.overCeiling
                      : styles.notLoaded
                }
              >
                {scenario.correct
                  ? "correct"
                  : scenario.overCeiling
                    ? "over ceiling"
                    : "incorrect"}
              </td>
              <td className={styles.secondary}>
                {scenario.fuel === null ? "—" : formatInteger(scenario.fuel)}
              </td>
              <td className={styles.secondary}>
                {/* An over-ceiling scenario answered correctly but too slowly, so
                    the useful figure is the overshoot: how far past the pass line
                    its fuel ran. Other rows keep the mismatch/failure detail. */}
                {scenario.overCeiling && scenario.fuel !== null
                  ? overshootDetail(scenario.fuel, fuelLimit)
                  : scenario.detail
                    ? scenario.detail
                    : scenario.firstMismatchTick !== null
                      ? `first mismatch at tick ${formatInteger(
                          scenario.firstMismatchTick,
                        )}`
                      : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail ? <p className={styles.secondary}>{detail}</p> : null}
    </Panel>
  );
}
