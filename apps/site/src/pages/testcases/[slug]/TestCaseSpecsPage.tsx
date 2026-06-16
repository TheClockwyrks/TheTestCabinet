import { Panel } from "../../../components/Panel";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import { SpecFileBrowser } from "./SpecFileBrowser";
import styles from "./TestCaseDetailPages.module.scss";

// The Specifications tab (`/test-cases/:slug/specs`): a filesystem browser over
// the exact files a run of the selected variant is seeded with — the same set
// `tcab seed --variant <slug>` materializes. The `key` resets the browser's file
// selection whenever the variant changes.
export function TestCaseSpecsPage() {
  return (
    <TestCaseDetailLayout tab="specs">
      {({ testCase, variant }) => (
        <Panel>
          <p className={styles.lead}>
            Every run of {testCase.name} ({variant.name}) starts from a fresh
            repository containing exactly these files.
          </p>
          <SpecFileBrowser key={variant.slug} variant={variant} />
        </Panel>
      )}
    </TestCaseDetailLayout>
  );
}
