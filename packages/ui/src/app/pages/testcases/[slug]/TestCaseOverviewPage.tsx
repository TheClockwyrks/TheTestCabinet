import { Markdown, Panel } from "@test-cabinet/ui";
import type { TestCaseDetail } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import styles from "./TestCaseDetailPages.module.scss";

// The Overview tab (`/test-cases/:slug`): the case's site-facing description,
// written for readers browsing the gallery rather than seeded into a run.
//
// The description is a property of the CASE, not of a version — there is one
// `description.md`, kept current with the latest version — so anchoring the page
// to an older version does not swap it out. Instead the tab says plainly which
// version the prose accompanies, so a reader looking at a superseded deliverable
// is never left assuming the description describes it.
export function TestCaseOverviewPage() {
  // The body reads nothing off the resolved coordinate, so it doubles as the
  // layout's fallback: the description stays readable even on a host that
  // cannot resolve the selected rendering.
  const body = ({
    testCase,
    version,
    isLatest,
  }: {
    testCase: TestCaseDetail;
    version: string;
    isLatest: boolean;
  }) => (
    <Panel>
      {!isLatest && (
        <p className={styles.anchorNote}>
          This description accompanies the latest version (
          {testCase.latestVersion}); you are viewing {version}.
        </p>
      )}
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
    <TestCaseDetailLayout tab="overview" fallback={body}>
      {body}
    </TestCaseDetailLayout>
  );
}
