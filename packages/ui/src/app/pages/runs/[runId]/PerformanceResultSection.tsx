import { useMemo, useState } from "react";
import { MetricTile, Panel } from "@test-cabinet/ui";
import type {
  PerformanceCaseResult,
  PerformanceResult,
  RunRecord,
} from "@test-cabinet/run-record";
import { formatInteger } from "../../../format";
import { useCaseRunSummaries } from "../../../data/useRuns";
import { useFindModel } from "../../../data/useModels";
import { perModelBestFuel, placeRunFuel } from "../../../data/fuelRanking";
import { canonicalModelId } from "../../../../modelId";
import {
  useGalleryData,
  type PerformanceScenarioView,
} from "../../../data/galleryContext";
import { PlaybackOverlay } from "./LatticePlaybackSection";
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
  const gallery = useGalleryData();
  const performance = run.validation.performance;

  // The scenarios that recorded a browser-playable factory, keyed by the case index
  // their row is at — so a scenario's row can launch its own playback in place. Only
  // a scenario the engine got right publishes one, so a failed row has no button.
  const playbackByIndex = useMemo(() => {
    const view = gallery.performancePlaybackFor(run);
    const map = new Map<number, PerformanceScenarioView>();
    for (const scenario of view?.scenarios ?? []) {
      if (scenario.scenarioUrl) map.set(scenario.caseIndex, scenario);
    }
    return map;
  }, [gallery, run]);

  // One player at a time (it covers the viewport); the launched case index selects
  // which scenario it replays.
  const [launched, setLaunched] = useState<number | null>(null);
  const active =
    launched !== null ? (playbackByIndex.get(launched) ?? null) : null;

  if (!performance) return null;
  return (
    <>
      <PerformanceResultBody
        result={performance}
        playbackByIndex={playbackByIndex}
        onLaunch={setLaunched}
      />
      {/* A run earns a placement only once it is correct with a fuel number; a
          failed run has no comparable result to rank. Mounted separately from the
          pure body so it, not the body, owns the case-scoped data fetch. */}
      {performance.correct && performance.totalFuel !== null ? (
        <PerformanceRankPanel run={run} fuel={performance.totalFuel} />
      ) : null}
      {/* The factory playback, launched from a scenario's row. It moved here from a
          separate Proof tab so the run's evidence sits with its scored result. */}
      {active ? (
        <PlaybackOverlay scenario={active} onExit={() => setLaunched(null)} />
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
        scenario set (lower fuel is better; each model counts once, at its
        best).
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
          This model already has a more efficient run of this scenario set
          (best: {formatInteger(modelBestFuel)} fuel), so this run is a slower
          duplicate — it does not change the model's leaderboard position.
        </p>
      ) : null}
    </Panel>
  );
}

/** A held-out scenario paired with the case index its playback is addressed by. */
interface ScenarioRow {
  scenario: PerformanceCaseResult;
  index: number;
}

/** The result cell's label and color for one scenario. */
function resultView(scenario: PerformanceCaseResult): {
  label: string;
  className: string | undefined;
} {
  if (scenario.correct) return { label: "correct", className: styles.loaded };
  if (scenario.overCeiling)
    return { label: "over ceiling", className: styles.overCeiling };
  // A skipped stress case never ran (a smoke test failed first): a muted "skipped",
  // not a red "incorrect" — the engine was never given it.
  if (scenario.skipped)
    return { label: "skipped", className: styles.secondary };
  return { label: "incorrect", className: styles.notLoaded };
}

/** The detail-cell text for one scenario. */
function detailText(
  scenario: PerformanceCaseResult,
  fuelLimit: number | null,
): string {
  // An over-ceiling scenario answered correctly but too slowly, so the useful figure
  // is the overshoot: how far past the pass line its fuel ran. Other rows keep the
  // mismatch/failure/skip detail.
  if (scenario.overCeiling && scenario.fuel !== null)
    return overshootDetail(scenario.fuel, fuelLimit);
  if (scenario.detail) return scenario.detail;
  if (scenario.firstMismatchTick !== null)
    return `first mismatch at tick ${formatInteger(scenario.firstMismatchTick)}`;
  return "";
}

/**
 * The per-scenario breakdown table for one phase (smoke or stress): which scenarios
 * reproduced the oracle's state, the fuel each burned (stress only — smoke fuel is
 * not scored), the diverging tick or failure detail, and a Play button that launches
 * that scenario's factory playback when the engine got it right.
 */
function ScenarioTable({
  rows,
  fuelLimit,
  showFuel,
  playbackByIndex,
  onLaunch,
}: {
  rows: ScenarioRow[];
  fuelLimit: number | null;
  showFuel: boolean;
  playbackByIndex?: Map<number, PerformanceScenarioView>;
  onLaunch?: (caseIndex: number) => void;
}) {
  return (
    <table className={styles.checks}>
      <thead>
        <tr>
          <th scope="col">Scenario</th>
          <th scope="col">Result</th>
          {showFuel ? <th scope="col">Fuel</th> : null}
          <th scope="col">Detail</th>
          <th scope="col">Playback</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ scenario, index }) => {
          const { label, className } = resultView(scenario);
          const view = playbackByIndex?.get(index);
          return (
            <tr key={scenario.input}>
              <th scope="row" className={styles.checkName}>
                {scenario.input}
              </th>
              <td className={className}>{label}</td>
              {showFuel ? (
                <td className={styles.secondary}>
                  {scenario.fuel === null ? "—" : formatInteger(scenario.fuel)}
                </td>
              ) : null}
              <td className={styles.secondary}>
                {detailText(scenario, fuelLimit)}
              </td>
              <td className={styles.playCell}>
                {view && onLaunch ? (
                  <button
                    type="button"
                    className={styles.playButton}
                    onClick={() => onLaunch(index)}
                  >
                    ▶ Play
                  </button>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The pure render of a resolved {@link PerformanceResult}, split out from the
 * run-reading wrapper so it can be exercised directly with a hand-built result.
 *
 * The held-out set is shown in two sections that mirror how it is scored: the
 * **smoke tests** (a correctness pre-flight — tiny per-behavior scenarios graded on
 * correctness alone, which gate everything after them) and the **stress scenarios**
 * (the large scored scenarios whose fuel total is the result). Each scenario the
 * engine got right carries a Play button that launches its factory playback.
 */
export function PerformanceResultBody({
  result,
  playbackByIndex,
  onLaunch,
}: {
  result: PerformanceResult;
  playbackByIndex?: Map<number, PerformanceScenarioView>;
  onLaunch?: (caseIndex: number) => void;
}) {
  const { correct, totalFuel, fuelLimit, cases, detail } = result;
  const total = cases.length;

  // Keep each case's index (playback addresses a scenario by it) while splitting the
  // set into its two scored phases.
  const rows: ScenarioRow[] = cases.map((scenario, index) => ({
    scenario,
    index,
  }));
  const smokeRows = rows.filter((r) => r.scenario.kind === "smoke");
  const stressRows = rows.filter((r) => r.scenario.kind !== "smoke");
  const nSmoke = smokeRows.length;
  const nStress = stressRows.length;
  const smokePass = smokeRows.filter((r) => r.scenario.correct).length;
  const smokeAllPass = nSmoke > 0 && smokePass === nSmoke;
  const stressPass = stressRows.filter((r) => r.scenario.correct).length;
  const stressOver = stressRows.filter((r) => r.scenario.overCeiling).length;
  const stressSkipped = stressRows.some((r) => r.scenario.skipped);

  // The gate line: correctness is all-or-nothing across the whole set. When a smoke
  // test failed, say so — the stress scenarios were skipped, not run-and-wrong.
  const passLine = correct
    ? nSmoke > 0
      ? `Correct — reproduced the reference oracle's exact state on every held-out scenario: all ${nSmoke} smoke ${
          nSmoke === 1 ? "test" : "tests"
        } and all ${nStress} stress ${nStress === 1 ? "scenario" : "scenarios"}.`
      : `Correct — all ${total} held-out ${
          total === 1 ? "scenario" : "scenarios"
        } reproduced the reference oracle's exact state.`
    : total === 0
      ? "Incorrect — this run produced no scored result."
      : nSmoke > 0 && !smokeAllPass
        ? `Incorrect — ${smokePass} of ${nSmoke} smoke ${
            nSmoke === 1 ? "test" : "tests"
          } passed. The stress scenarios run only after every smoke test passes, so they were not run.`
        : `Incorrect — ${stressPass} of ${nStress} stress ${
            nStress === 1 ? "scenario" : "scenarios"
          } passed within the fuel ceiling; a run earns a fuel score only when every one does.${
            stressOver > 0
              ? ` ${stressOver} produced the correct answer but ran over the ceiling — see how far over below.`
              : ""
          }`;

  return (
    <Panel>
      <h2 className={`${styles.section} ${styles.leadHeading}`}>
        Performance result
      </h2>

      <p className={correct ? styles.loaded : styles.notLoaded}>{passLine}</p>

      {/* Correctness gate + the fuel score. Fuel is only meaningful for a correct
          engine, so it is an em dash otherwise. Only the stress scenarios' fuel is
          scored — smoke tests are a correctness pre-flight. */}
      <div className={`${styles.metricRow} ${styles.cols2}`}>
        <MetricTile label="Correctness" value={correct ? "Pass" : "Fail"} />
        <MetricTile
          label="Total fuel"
          value={totalFuel === null ? "—" : formatInteger(totalFuel)}
          title="Lower is better — the fuel a correct engine consumed across the stress scenarios (smoke tests are not metered)."
        />
      </div>

      {/* Smoke tests: the correctness pre-flight. Shown as its own section so it
          reads as part of the one test case, but clearly the gate — graded on
          correctness, not fuel — that the stress scenarios sit behind. */}
      {nSmoke > 0 ? (
        <div className={styles.scenarioGroup}>
          <h3 className={styles.checklistHeading}>Smoke tests</h3>
          <p className={styles.secondary}>
            A correctness pre-flight: each tiny scenario exercises one behavior
            in isolation (a belt, a side-load, a splitter, an inserter, an
            assembler). Every smoke test must pass before the stress scenarios
            run, so a broken engine is caught immediately. Graded on correctness
            only — fuel is not scored here.
          </p>
          <ScenarioTable
            rows={smokeRows}
            fuelLimit={fuelLimit}
            showFuel={false}
            playbackByIndex={playbackByIndex}
            onLaunch={onLaunch}
          />
        </div>
      ) : null}

      {/* Stress scenarios: the scored set whose fuel total is the result. */}
      {nStress > 0 ? (
        <div className={styles.scenarioGroup}>
          {nSmoke > 0 ? (
            <h3 className={styles.checklistHeading}>Stress scenarios</h3>
          ) : null}
          <p className={styles.secondary}>
            {stressSkipped
              ? "The large held-out scenarios whose fuel total is the score — not run this time, because a smoke test failed first."
              : "The large held-out scenarios whose fuel total is the score. Correctness is a gate: only a correct engine earns a fuel score, and lower fuel is better."}
          </p>
          <ScenarioTable
            rows={stressRows}
            fuelLimit={fuelLimit}
            showFuel
            playbackByIndex={playbackByIndex}
            onLaunch={onLaunch}
          />
        </div>
      ) : null}

      {detail ? <p className={styles.secondary}>{detail}</p> : null}
    </Panel>
  );
}
