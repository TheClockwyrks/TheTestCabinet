import { Markdown } from "@clockwyrks/ui";
import { InputBrowser } from "../../../components/InputBrowser";
import type { TestCaseDetail } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";

// The Changelog tab (`/test-cases/:slug/changelog`): every version's changelog
// entry, newest first, each labeled with the version it describes. The entries
// are assembled per host from each version's `changelog.md` (see TestCaseSummary).
//
// This renders through the same `InputBrowser` as the Inputs tab, so a case's
// changelog reads identically to its inputs: the versions in the rail, the
// selected entry on the stage beside them. The tab is whole-history — every
// version's entry is listed regardless of the anchor — but the anchored
// version's entry starts selected, since the entry for the deliverable being
// looked at is the one the reader came to check.
export function TestCaseChangelogPage() {
  // The body reads nothing off the resolved coordinate, so it doubles as the
  // layout's fallback: whole-history data stays readable even on a host that
  // cannot resolve the selected rendering.
  const body = ({
    testCase,
    version,
  }: {
    testCase: TestCaseDetail;
    version: string;
  }) => (
    <InputBrowser
      // Keyed by the anchor so re-anchoring (the header's version select)
      // remounts the browser and the newly-anchored entry is selected; the
      // browser reads `initialSelectedId` on mount only.
      key={`${testCase.slug}@${version}`}
      groups={[
        {
          label: "Versions",
          items: testCase.changelog.map((entry) => ({
            id: entry.version,
            label: entry.version,
            render: () => <Markdown>{entry.body}</Markdown>,
          })),
        },
      ]}
      initialSelectedId={version}
      emptyLabel={`No changelog has been recorded for ${testCase.name} yet.`}
    />
  );
  return (
    <TestCaseDetailLayout tab="changelog" fallback={body}>
      {body}
    </TestCaseDetailLayout>
  );
}
