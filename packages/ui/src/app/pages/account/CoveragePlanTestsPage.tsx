import { useCoveragePlan } from "./CoveragePlanLayout";
import { MatrixSection } from "./CoverageMatrixSection";
import styles from "./Coverage.module.scss";

// The plan's Tests tab (`/account/coverage/:planId/tests`): the matrix of what the plan
// still needs, grouped and ordered exactly as the plan runs it.
//
// Each block expands to its cells, and each cell carries the two presses that launch it
// by hand: one more run, or the whole shortfall. A hand launch ignores the plan's
// runs-in-flight limit (it is a deliberate press) but counts toward it. A cell blocked
// on a run that used up its automatic retries offers Retry.
export function CoveragePlanTestsPage() {
  const { groups, coverage, busy, canTrigger, triggerCells, retryCell } =
    useCoveragePlan();
  return (
    <div className={styles.matrix}>
      {groups.map((group) => (
        <MatrixSection
          key={group.key}
          group={group}
          axis={coverage.outerAxis}
          busy={busy}
          canTrigger={canTrigger}
          onTrigger={triggerCells}
          onRetry={(cell) => void retryCell(cell)}
        />
      ))}
    </div>
  );
}
