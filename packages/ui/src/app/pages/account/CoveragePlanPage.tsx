import { useId } from "react";
import { MetricTile, Panel } from "@clockwyrks/ui";
import { Switch } from "../../components/Switch";
import { useTestCaseName } from "../../data/useTestCaseName";
import { useBackend } from "../../../client/context";
import { axisLabel } from "./coveragePickers";
import { bufferedStatTitle, formatBufferTarget } from "./bufferTarget";
import { useCoveragePlan } from "./CoveragePlanLayout";
import { CoveragePlanMetrics } from "./CoveragePlanMetrics";
import { useCoverageRunMetrics } from "./coverageMetrics";
import exec from "../runs/RunExec.module.scss";
import styles from "./Coverage.module.scss";

// The plan's Dashboard tab (`/account/coverage/:planId`): where the plan stands, the
// controls that move it, and what the runs it has already bought turned out to be.
//
// It is the tab a reviewer lands on because it is the only one that answers "should I
// do anything?" — the board's shortfall and the buffer's occupancy are the two numbers
// the controls beneath them act on. The controls carry the plan's state themselves —
// the switch reads on or off, a halt moves it — and no tile restates what a control
// already shows.
export function CoveragePlanPage() {
  const state = useCoveragePlan();
  const { client: backend } = useBackend();
  const testCaseName = useTestCaseName();
  const { coverage, plan, busy, autoTopUp } = state;
  const autoTopUpId = useId();
  const runs = useCoverageRunMetrics(coverage, testCaseName);
  const blockedCells = coverage.cells.filter((c) => c.unlaunchable).length;
  const nothingLeft = state.deficientCells.length === 0;

  return (
    <div className={styles.dashboard}>
      <Panel className={styles.boardPanel}>
        <h2 className={styles.metricsTitle}>Coverage</h2>
        <div className={styles.metricTiles}>
          <MetricTile
            label="Cells covered"
            value={`${coverage.cellsSatisfied}/${coverage.cellsTotal}`}
          />
          <MetricTile
            label="Runs missing"
            value={String(coverage.runsMissing)}
          />
          {/* A cell nothing can launch is missing runs that will never arrive, which
              no other figure here explains — a plan whose whole shortfall is broken
              members reads as merely idle without it. The reason for each lives on its
              own row of the Tests tab. */}
          {blockedCells > 0 && (
            <MetricTile
              label="Blocked cells"
              value={String(blockedCells)}
              title="Cells a top-up cannot launch at all. Expand the block on the Tests tab for the reason on each, then fix or drop the combination."
            />
          )}
          <MetricTile
            label="Buffered"
            value={`${coverage.runsOutstanding}/${formatBufferTarget(coverage.bufferTarget)}`}
            title={bufferedStatTitle(coverage.bufferTarget)}
          />
          <MetricTile
            label="To review"
            value={String(coverage.runsUnreviewed)}
            title="Completed runs of this plan you have not reviewed."
          />
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
          <label
            className={styles.controlToggle}
            htmlFor={autoTopUpId}
            title="On: this plan tops itself up when you open it and each time you submit a review, up to the review buffer. Off: only Top up now enqueues, and whatever is queued is left alone."
          >
            <Switch
              id={autoTopUpId}
              checked={autoTopUp}
              disabled={busy || !plan || !backend?.setCoveragePlanSchedule}
              onChange={(on) => void state.setAutoTopUp(on)}
            />
            Auto top-up
          </label>
          <span className={`${styles.controlActions} ${styles.controlEnd}`}>
            <button
              type="button"
              className={exec.primary}
              disabled={busy || !plan || !backend?.topUpCoveragePlan}
              title="Enqueue the next runs this plan needs, up to the review buffer."
              onClick={() => void state.topUpNow()}
            >
              {busy ? "Working…" : "Top up now"}
            </button>
            <button
              type="button"
              className={exec.secondary}
              disabled={busy || !backend?.haltCoveragePlan}
              title="Switch auto top-up off, and cancel this plan's jobs that have not started yet."
              onClick={() => void state.halt(false)}
            >
              Halt
            </button>
            <button
              type="button"
              className={exec.danger}
              disabled={busy || !backend?.haltAllCoveragePlan}
              title="Switch auto top-up off, and cancel every job this plan launched, runs already executing included."
              onClick={() => void state.halt(true)}
            >
              Halt all
            </button>
            <button
              className={exec.secondary}
              type="button"
              disabled={
                busy || !state.canTrigger || state.deficientCells.length === 0
              }
              title={
                nothingLeft && blockedCells > 0
                  ? "Nothing can be launched: every cell that is short of its target is blocked."
                  : nothingLeft
                    ? "Nothing to launch: every cell is at its target."
                    : "Launch every run this plan is still missing, across every cell that can be launched."
              }
              onClick={() => void state.triggerCells(state.deficientCells)}
            >
              ▶ All missing
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
