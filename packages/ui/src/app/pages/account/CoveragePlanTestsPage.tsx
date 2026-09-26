import { useCoveragePlan } from "./CoveragePlanLayout";
import { MatrixSection } from "./CoverageMatrixSection";
import styles from "./Coverage.module.scss";

// The plan's Tests tab (`/account/coverage/:planId/tests`): the matrix of what the plan
// still needs, grouped and ordered exactly as the plan runs it.
//
// Each block expands to its cells, and each cell carries the two presses that fill it:
// one more run, or the whole shortfall.
export function CoveragePlanTestsPage() {
  const { groups, coverage, busy, canTrigger, triggerCells } =
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
        />
      ))}
    </div>
  );
}
