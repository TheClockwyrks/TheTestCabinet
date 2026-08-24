import { Markdown, SpecAccordion, type AccordionEntry } from "@test-cabinet/ui";
import type { TestCaseDetail } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";

// The Changelog tab (`/test-cases/:slug/changelog`): every version's changelog
// entry, newest first, each labeled with the version it describes. The entries
// are assembled per host from each version's `changelog.md` (see TestCaseSummary).
//
// This renders through the same `SpecAccordion` as the Inputs tab, so a case's
// changelog reads identically to its inputs: a stack of collapsible panels. The
// tab is whole-history — every version's entry is listed regardless of the
// anchor — but the anchored version's entry starts expanded, since the entry for
// the deliverable being looked at is the one the reader came to check. Unlike
// inputs there is no right-aligned kind — a changelog entry carries only its
// version — so the header shows the version alone.
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
  }) => {
    const entries: AccordionEntry[] = testCase.changelog.map((entry) => ({
      path: entry.version,
      initiallyOpen: entry.version === version,
      body: <Markdown>{entry.body}</Markdown>,
    }));
    return (
      <SpecAccordion
        // Keyed by the anchor so re-anchoring (the header's version select)
        // remounts the stack and the newly-anchored entry opens; the
        // accordion reads `initiallyOpen` on mount only.
        key={`${testCase.slug}@${version}`}
        entries={entries}
        emptyLabel={`No changelog has been recorded for ${testCase.name} yet.`}
      />
    );
  };
  return (
    <TestCaseDetailLayout tab="changelog" fallback={body}>
      {body}
    </TestCaseDetailLayout>
  );
}
