import { Markdown, Panel } from "@clockwyrks/ui";
import type { TestCaseDetail } from "../../../data/testCases";
import { JamDetailLayout } from "../../../layouts/gamejams/JamDetailLayout";
import styles from "../../testcases/[slug]/TestCaseDetailPages.module.scss";

// The Overview tab (`/game-jams/:slug`): the jam's site-facing description,
// written for readers rather than seeded into a run. Mirrors the test-case
// Overview tab.
export function JamOverviewPage() {
  // The body reads nothing off the resolved coordinate, so it doubles as the
  // layout's fallback (see the test-case Overview tab).
  const body = ({ testCase }: { testCase: TestCaseDetail }) => (
    <Panel>
      {testCase.description ? (
        <Markdown>{testCase.description}</Markdown>
      ) : (
        <p className={styles.empty}>
          No description has been written for {testCase.name} yet.
        </p>
      )}
    </Panel>
  );
  return (
    <JamDetailLayout tab="overview" fallback={body}>
      {body}
    </JamDetailLayout>
  );
}
