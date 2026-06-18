import {
  SpecAccordion,
  type AccordionEntry,
} from "@test-cabinet/ui";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";

// The References tab (`/test-cases/:slug/references`): the rendered reference
// screenshots that are the visual targets for the selected variant. They are
// validation material, not seeded into a run, so they live on their own tab
// apart from the Specifications files — but share the same full-width accordion
// styling. The `key` collapses every panel again when the variant changes.
export function TestCaseReferencesPage() {
  return (
    <TestCaseDetailLayout tab="references">
      {({ variant }) => {
        const entries: AccordionEntry[] = variant.referenceScreenshots.map(
          (shot) => ({
            path: `reference/${shot.view}.png`,
            kind: "image",
            body: <img src={shot.url} alt={`${variant.name} ${shot.view}`} />,
          }),
        );
        return (
          <SpecAccordion
            key={variant.slug}
            entries={entries}
            emptyLabel="This variant has no reference images."
          />
        );
      }}
    </TestCaseDetailLayout>
  );
}
