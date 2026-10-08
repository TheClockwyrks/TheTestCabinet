import styles from "./suite-detail-pages.module.scss";
import { SuiteDetailLayout } from "../../../layouts/testsuites/suite-detail-layout";
import { Markdown, Panel } from "@clockwyrks/ui";

// The Changelog tab (`/test-cases/suites/:suiteSlug/changelog`): the anchored
// version's `changelog.md`, rendered as Markdown.
//
// Unlike a test case's changelog this is per-version rather than whole-history: a
// suite version is a frozen unit and records what changed in itself, so the tab
// describes the one version the page is anchored to, and the header's version
// selector is how a reader reaches another one's entry.
export function SuiteChangelogPage() {
  return (
    <SuiteDetailLayout tab="changelog">
      {({ suite, version }) => (
        <Panel>
          {suite.changelog.trim() ? (
            <Markdown className={styles.prose}>{suite.changelog}</Markdown>
          ) : (
            <p className={styles.note}>
              No changes are recorded for {version}.
            </p>
          )}
        </Panel>
      )}
    </SuiteDetailLayout>
  );
}
