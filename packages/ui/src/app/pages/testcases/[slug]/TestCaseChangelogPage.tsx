import { Markdown, SpecAccordion, type AccordionEntry } from "@test-cabinet/ui";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";

// The Changelog tab (`/test-cases/:slug/changelog`): every version's changelog
// entry, newest first, each labeled with the version it describes. The entries
// are assembled per host from each version's `changelog.md` (see TestCaseSummary).
//
// This renders through the same `SpecAccordion` as the Inputs tab, so a case's
// changelog reads identically to its inputs: a stack of collapsible panels, each
// starting collapsed. Unlike inputs there is no right-aligned kind — a changelog
// entry carries only its version — so the header shows the version alone.
export function TestCaseChangelogPage() {
  return (
    <TestCaseDetailLayout tab="changelog">
      {({ testCase }) => {
        const entries: AccordionEntry[] = testCase.changelog.map((entry) => ({
          path: entry.version,
          body: <Markdown>{entry.body}</Markdown>,
        }));
        return (
          <SpecAccordion
            key={testCase.slug}
            entries={entries}
            emptyLabel={`No changelog has been recorded for ${testCase.name} yet.`}
          />
        );
      }}
    </TestCaseDetailLayout>
  );
}
