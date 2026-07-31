import { Panel } from "@test-cabinet/ui";
import type { RunRecord } from "@test-cabinet/run-record";
import { VariantInputsView } from "../../../components/VariantViews";
import { useRunVariant } from "../../../data/useRunVariant";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { GameJamPriorEntries } from "./GameJamPriorEntries";
import styles from "./RunDetailPages.module.scss";

// The Inputs tab (`/runs/:runId/inputs`): the prompt, seeded files, and reference
// media the run was given — resolved from the catalog by the run's subject and
// rendered with the same `VariantInputsView` the test-case Inputs tab uses. It
// saves a reviewer from leaving the run to the test-case section to see what was
// asked for and what it was judged against. Available on every host (the public
// site included).
//
// A game-jam run leads with the one input that is *not* shared with every other
// run of the case: the earlier entries of the same model it was seeded with and
// asked to differ from.
export function RunInputsPage() {
  return (
    <RunDetailLayout tab="inputs">
      {({ run }) => <RunInputsBody run={run} />}
    </RunDetailLayout>
  );
}

function RunInputsBody({ run }: { run: RunRecord }) {
  const variant = useRunVariant(run.subject);
  return (
    <>
      {run.subject.testType === "game-jam" && (
        <GameJamPriorEntries entries={run.gameJamPriorEntries ?? []} />
      )}
      {variant ? (
        <VariantInputsView variant={variant} />
      ) : (
        <Panel>
          <p className={styles.empty}>
            The inputs for this run&rsquo;s test case are not available.
          </p>
        </Panel>
      )}
    </>
  );
}
