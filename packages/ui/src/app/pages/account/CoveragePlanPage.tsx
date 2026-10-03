import { MetricTile, Panel } from "@clockwyrks/ui";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useBackend } from "../../../client/context";
import { axisLabel } from "./coveragePickers";
import {
  describeInFlightLimit,
  formatInFlightLimit,
  inFlightStatTitle,
  limitLaunchesNothing,
} from "./inFlightLimit";
import { ZERO_LIMIT_NOTE } from "./coveragePlan";
import { useCoveragePlan } from "./CoveragePlanLayout";
import { CoveragePlanMetrics } from "./CoveragePlanMetrics";
import { useCoverageRunMetrics } from "./coverageMetrics";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The plan's Dashboard tab (`/account/coverage/:planId`): where the plan stands, the
// controls that move it, and what the runs it has already bought turned out to be.
//
// It is the tab a reviewer lands on because it is the only one that answers "should I
// do anything?": cells filled and runs done say how far the plan is, and All missing
// is the one press that fills the rest. The controls carry the plan's state
// themselves — the control line says when the plan is filling — and no tile restates
// what a control already shows. All missing stays pressable while the plan fills: a
// press runs another launch pass, which resumes a fill whose runs a global cancel
// swept away.
export function CoveragePlanPage() {
  const state = useCoveragePlan();
  const { client: backend } = useBackend();
  const testCaseName = useTestCaseName();
  const { coverage, plan, busy, filling } = state;
  const runs = useCoverageRunMetrics(state.planId, coverage, testCaseName);
  // Cells that cannot be filled as things stand: an unlaunchable combination, or a
  // cell blocked on repeated infrastructure failures (which offers Retry).
  const blockedCells = coverage.cells.filter(
    (c) => c.unlaunchable || c.blocked,
  ).length;
  const nothingLeft = state.deficientCells.length === 0;
  const limit = describeInFlightLimit(coverage.inFlightLimit);
  const zeroLimit = limitLaunchesNothing(coverage.inFlightLimit);

  return (
    <div className={styles.dashboard}>
      <Panel className={styles.boardPanel}>
        <h2 className={styles.metricsTitle}>Coverage</h2>
        <div className={styles.metricTiles}>
          <MetricTile
            label="Cells filled"
            value={`${coverage.cellsFilled}/${coverage.cellsTotal}`}
            title="Cells holding at least their target of runs that count: completed runs and the model's own failures (timed out, broken, over a limit, hung). Infrastructure failures and cancelled runs never count."
          />
          <MetricTile
            label="Runs"
            value={`${coverage.runsDone}/${coverage.runsTotal}`}
            title={`Runs that count, capped at each cell's target, out of every cell's target. ${coverage.runsMissing} still to launch.`}
          />
          <MetricTile
            label="In flight"
            value={`${coverage.runsInFlight}/${formatInFlightLimit(coverage.inFlightLimit)}`}
            title={inFlightStatTitle(coverage.inFlightLimit, "plan")}
          />
          <MetricTile
            label="To review"
            value={String(coverage.runsUnreviewed)}
            title="Completed runs of this plan you have not reviewed. Informational: reviews never launch or hold back runs."
          />
          {/* Last of the primary figures, and only when there is one, so it appearing
              never moves the others. The reason and the fix for each cell live on its
              own row of the Tests tab. */}
          {blockedCells > 0 && (
            <MetricTile
              label="Blocked cells"
              value={String(blockedCells)}
              title="Cells this plan cannot fill as things stand: a combination that cannot be launched, or a cell whose last 3 runs failed on infrastructure. Open the Tests tab for the reason on each; a blocked cell offers Retry."
            />
          )}
          <MetricTile
            label="Pending"
            value={String(coverage.runsPending)}
            secondary
            title="In-flight runs the queue is deliberately holding back, because the harness is at its parallelism cap or a game jam is already running on that model. A subset of the runs in flight, not an addition to them."
          />
          <MetricTile
            label="Runs in this order"
            value={axisLabel(coverage.outerAxis)}
            secondary
            title="The axis this plan's cell loop nests on, and so the order its runs execute in. Change it from the plan editor."
          />
        </div>
      </Panel>

      <Panel className={styles.controlPanel}>
        <h2 className={styles.metricsTitle}>Controls</h2>
        <div className={`${styles.controls} ${styles.panelControls}`}>
          {/* What the controls do, for someone who has never pressed them. */}
          <span className={styles.controlOrder}>
            {zeroLimit && !nothingLeft
              ? ZERO_LIMIT_NOTE
              : filling
                ? "Filling: the rest launch as this plan's runs finish. Halt stops filling."
                : nothingLeft && blockedCells === 0
                  ? "Every cell is at its target or has runs in flight. Raise runs per cell in the editor for more evidence."
                  : `All missing launches the runs this plan still needs, ${limit === "no limit" ? "all at once" : `up to ${limit}`}, and keeps launching as they finish.`}
          </span>
          <span className={`${styles.controlActions} ${styles.controlEnd}`}>
            <button
              type="button"
              className={exec.primary}
              disabled={
                busy ||
                zeroLimit ||
                nothingLeft ||
                !plan ||
                !backend?.fillCoveragePlan
              }
              title={
                zeroLimit
                  ? ZERO_LIMIT_NOTE
                  : nothingLeft && blockedCells > 0
                    ? "Nothing can be launched: every cell short of its target is blocked."
                    : nothingLeft
                      ? "Nothing to launch: every cell is at its target or has runs in flight."
                      : filling
                        ? "This plan is filling: its missing runs launch as its runs finish. Press to launch any that are missing with room under the limit now."
                        : "Launch this plan's missing runs, up to its runs-in-flight limit, and keep launching as they finish."
              }
              onClick={() => void state.fill()}
            >
              ▶ All missing
            </button>
            <button
              type="button"
              className={exec.secondary}
              disabled={busy || !backend?.haltCoveragePlan}
              title="Stop filling, and cancel this plan's runs that have not started yet."
              onClick={() => void state.halt(false)}
            >
              Halt
            </button>
            <button
              type="button"
              className={exec.danger}
              disabled={busy || !backend?.haltAllCoveragePlan}
              title="Stop filling, and cancel every run this plan launched, runs already executing included."
              onClick={() => void state.halt(true)}
            >
              Halt all
            </button>
          </span>
        </div>
      </Panel>

      <CoveragePlanMetrics
        metrics={runs.metrics}
        loading={runs.loading}
        error={runs.error}
      />
    </div>
  );
}
