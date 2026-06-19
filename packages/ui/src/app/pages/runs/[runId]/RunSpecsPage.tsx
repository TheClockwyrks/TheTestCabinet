import { Panel } from "@test-cabinet/ui";
import type { RunSubject } from "@test-cabinet/run-record";
import { VariantSpecsView } from "../../../components/VariantViews";
import { useRunVariant } from "../../../data/useRunVariant";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import styles from "./RunDetailPages.module.scss";

// The Specifications tab (`/runs/:runId/specs`): the prompt and seeded files the
// run was given, resolved from the catalog by the run's subject and rendered with
// the same `VariantSpecsView` the test-case Specifications tab uses. It saves a
// reviewer from leaving the run to the test-case section to see what was asked
// for. Available on every host (the public site included).
export function RunSpecsPage() {
  return (
    <RunDetailLayout tab="specs">
      {({ run }) => <RunSpecsBody subject={run.subject} />}
    </RunDetailLayout>
  );
}

function RunSpecsBody({ subject }: { subject: RunSubject }) {
  const variant = useRunVariant(subject);
  if (!variant) {
    return (
      <Panel>
        <p className={styles.empty}>
          The specifications for this run&rsquo;s test case are not available.
        </p>
      </Panel>
    );
  }
  return <VariantSpecsView variant={variant} />;
}
