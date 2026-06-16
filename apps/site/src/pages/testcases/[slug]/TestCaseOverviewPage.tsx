import { Markdown } from "../../../components/Markdown";
import { Panel } from "../../../components/Panel";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import styles from "./TestCaseDetailPages.module.scss";

// The Overview tab (`/test-cases/:slug`): the case's site-facing description,
// written for readers browsing the gallery rather than seeded into a run.
export function TestCaseOverviewPage() {
  return (
    <TestCaseDetailLayout tab="overview">
      {({ testCase }) => (
        <Panel>
          {testCase.description ? (
            <Markdown>{testCase.description}</Markdown>
          ) : (
            <p className={styles.empty}>
              No description has been written for {testCase.name} yet.
            </p>
          )}
        </Panel>
      )}
    </TestCaseDetailLayout>
  );
}
