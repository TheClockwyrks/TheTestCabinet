import { Panel } from "@test-cabinet/ui";
import type { RunRecord } from "@test-cabinet/run-record";
import {
  VariantInputsView,
  type RunSeededInput,
} from "../../../components/VariantViews";
import { useRunVariant } from "../../../data/useRunVariant";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import styles from "./RunDetailPages.module.scss";

// The Inputs tab (`/runs/:runId/inputs`): the prompt, seeded files, and reference
// media the run was given — resolved from the catalog by the run's subject and
// rendered with the same `VariantInputsView` the test-case Inputs tab uses. It
// saves a reviewer from leaving the run to the test-case section to see what was
// asked for and what it was judged against. Available on every host (the public
// site included).
//
// A game-jam run carries one set of inputs that is *not* shared with every other
// run of the case: the earlier entries' READMEs it was seeded with and asked to
// differ from. They read as what they are — seeded files — so they join the same
// accordion rather than sitting in a callout of their own.
export function RunInputsPage() {
  return (
    <RunDetailLayout tab="inputs">
      {({ run }) => <RunInputsBody run={run} />}
    </RunDetailLayout>
  );
}

function RunInputsBody({ run }: { run: RunRecord }) {
  const variant = useRunVariant(run.subject);
  return variant ? (
    // Keyed by run so moving between two runs of the same variant collapses the
    // panels again rather than leaving one open over a different run's entry.
    <VariantInputsView
      key={run.id}
      variant={variant}
      runSeededInputs={priorEntryInputs(run)}
    />
  ) : (
    <Panel>
      <p className={styles.empty}>
        The inputs for this run&rsquo;s test case are not available.
      </p>
    </Panel>
  );
}

// The `previous-entries/` files a repeated game-jam run was seeded with: one
// numbered Markdown file per earlier entry of the same jam by the same model,
// oldest first, holding that entry's player-facing README. The paths mirror what
// seeding writes into the workspace, so what is listed here is what the model
// read. A jam's first run for a model was seeded with none and simply shows the
// jam's own inputs.
function priorEntryInputs(run: RunRecord): RunSeededInput[] {
  return (run.gameJamPriorEntries ?? []).map((entry, index) => ({
    path: `previous-entries/entry-${String(index + 1).padStart(2, "0")}.md`,
    kind: "entry",
    text: entry.readme,
  }));
}
