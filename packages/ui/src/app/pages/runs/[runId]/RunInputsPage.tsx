import { Panel } from "@test-cabinet/ui";
import type { RunSubject } from "@test-cabinet/run-record";
import { VariantInputsView } from "../../../components/VariantViews";
import { useRunVariant } from "../../../data/useRunVariant";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import styles from "./RunDetailPages.module.scss";

// The Inputs tab (`/runs/:runId/inputs`): the prompt, seeded files, and reference
// media the run was given — resolved from the catalog by the run's subject and
// rendered with the same `VariantInputsView` the test-case Inputs tab uses. It
// saves a reviewer from leaving the run to the test-case section to see what was
// asked for and what it was judged against. Available on every host (the public
// site included).
export function RunInputsPage() {
  return (
    <RunDetailLayout tab="inputs">
      {({ run }) => <RunInputsBody subject={run.subject} />}
    </RunDetailLayout>
  );
}

function RunInputsBody({ subject }: { subject: RunSubject }) {
  const variant = useRunVariant(subject);
  if (!variant) {
    return (
      <Panel>
        <p className={styles.empty}>
          The inputs for this run&rsquo;s test case are not available.
        </p>
      </Panel>
    );
  }
  return <VariantInputsView variant={variant} />;
}
