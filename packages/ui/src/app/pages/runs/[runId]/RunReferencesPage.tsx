import { Panel } from "@test-cabinet/ui";
import type { RunSubject } from "@test-cabinet/run-record";
import { VariantReferencesView } from "../../../components/VariantViews";
import { useRunVariant } from "../../../data/useRunVariant";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import styles from "./RunDetailPages.module.scss";

// The References tab (`/runs/:runId/references`): the rendered reference
// screenshots that were the run's visual targets, resolved from the catalog by
// the run's subject and rendered with the same `VariantReferencesView` the
// test-case References tab uses. It pairs with the Specifications tab so a
// reviewer can see both what was asked for and what it was judged against without
// leaving the run. Available on every host (the public site included).
export function RunReferencesPage() {
  return (
    <RunDetailLayout tab="references">
      {({ run }) => <RunReferencesBody subject={run.subject} />}
    </RunDetailLayout>
  );
}

function RunReferencesBody({ subject }: { subject: RunSubject }) {
  const variant = useRunVariant(subject);
  if (!variant) {
    return (
      <Panel>
        <p className={styles.empty}>
          The reference images for this run&rsquo;s test case are not available.
        </p>
      </Panel>
    );
  }
  return <VariantReferencesView variant={variant} />;
}
