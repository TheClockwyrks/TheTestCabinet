import { Markdown, Panel } from "@test-cabinet/ui";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import styles from "./TestCaseDetailPages.module.scss";

// The Changelog tab (`/test-cases/:slug/changelog`): every version's changelog
// entry, newest first, each labeled with the version it describes. The entries
// are assembled per host from each version's `changelog.md` (see TestCaseSummary).
export function TestCaseChangelogPage() {
  return (
    <TestCaseDetailLayout tab="changelog">
      {({ testCase }) => (
        <Panel>
          {testCase.changelog.length > 0 ? (
            <div className={styles.changelog}>
              {testCase.changelog.map((entry) => (
                <section key={entry.version} className={styles.entry}>
                  <span className={styles.entryVersion}>{entry.version}</span>
                  <Markdown className={styles.entryBody}>{entry.body}</Markdown>
                </section>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>
              No changelog has been recorded for {testCase.name} yet.
            </p>
          )}
        </Panel>
      )}
    </TestCaseDetailLayout>
  );
}
