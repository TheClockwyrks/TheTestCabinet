import { MetricTile, Panel } from "@test-cabinet/ui";
import type {
  PerformanceResult,
  RunRecord,
} from "@test-cabinet/run-record";
import { formatInteger } from "../../../format";
import styles from "./RunDetailPages.module.scss";

/**
 * The correctness-and-fuel result of a performance run, shown at the top of the
 * Verdict tab (a performance run has no Play tab and no proof media, so this is
 * where its auto-scored result lives). It leads with the correctness gate and the
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
  return <PerformanceResultBody result={performance} />;
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
  const { correct, totalFuel, cases, detail } = result;
  const total = cases.length;
  const correctCount = cases.filter((scenario) => scenario.correct).length;

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
              } reproduced the reference state; a run earns a fuel score only when every one does.`
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
        Correctness is a gate: only a correct engine earns a fuel score, and lower
        fuel is better. The breakdown below is per held-out scenario.
      </p>

      {/* Per-scenario breakdown: which scenarios reproduced the oracle's state,
          the fuel each burned (kept even when incorrect, for diagnostics), and —
          for an incorrect scenario — where it first diverged or why it could not
          be scored. */}
      <table className={styles.checks}>
        <thead>
          <tr>
            <th scope="col">Scenario</th>
            <th scope="col">Correct</th>
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
                className={scenario.correct ? styles.loaded : styles.notLoaded}
              >
                {scenario.correct ? "correct" : "incorrect"}
              </td>
              <td className={styles.secondary}>
                {scenario.fuel === null ? "—" : formatInteger(scenario.fuel)}
              </td>
              <td className={styles.secondary}>
                {scenario.detail
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
