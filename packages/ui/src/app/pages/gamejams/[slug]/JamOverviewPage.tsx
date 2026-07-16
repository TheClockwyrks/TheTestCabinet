import { Markdown, Panel } from "@test-cabinet/ui";
import { JamDetailLayout } from "../../../layouts/gamejams/JamDetailLayout";
import styles from "../../testcases/[slug]/TestCaseDetailPages.module.scss";

// The Overview tab (`/game-jams/:slug`): the jam's site-facing description,
// written for readers rather than seeded into a run. Mirrors the test-case
// Overview tab.
export function JamOverviewPage() {
  return (
    <JamDetailLayout tab="overview">
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
    </JamDetailLayout>
  );
}
