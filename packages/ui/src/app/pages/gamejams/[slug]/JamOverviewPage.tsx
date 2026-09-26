import { Markdown, Panel } from "@clockwyrks/ui";
import type { TestCaseDetail } from "../../../data/testCases";
import { JamDetailLayout } from "../../../layouts/gamejams/JamDetailLayout";
import styles from "../../testcases/[slug]/TestCaseDetailPages.module.scss";

// The Overview tab (`/game-jams/:slug`): the anchored version's site-facing
// description, written for readers rather than seeded into a run. Mirrors the
// test-case Overview tab, including reading the description of the version
// being viewed rather than the latest one's.
export function JamOverviewPage() {
  // The body reads nothing off the resolved coordinate, so it doubles as the
  // layout's fallback (see the test-case Overview tab).
  const body = ({
    testCase,
    version,
  }: {
    testCase: TestCaseDetail;
    version: string;
  }) => {
    const description = testCase.descriptionsByVersion[version] ?? null;
    return (
      <Panel>
        {description ? (
          <Markdown>{description}</Markdown>
        ) : (
          <p className={styles.empty}>
            No description has been written for {testCase.name} yet.
          </p>
        )}
      </Panel>
    );
  };
  return (
    <JamDetailLayout tab="overview" fallback={body}>
      {body}
    </JamDetailLayout>
  );
}
