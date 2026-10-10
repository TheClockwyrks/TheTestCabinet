import styles from "./suite-detail-pages.module.scss";
import { SuiteRequirementList } from "./suite-requirement-list";
import { SuiteDetailLayout } from "../../../layouts/testsuites/suite-detail-layout";
import { Markdown, SpecAccordion } from "@clockwyrks/ui";
import type { AccordionEntry } from "@clockwyrks/ui";

// The Specifications tab (`/test-cases/suites/:suiteSlug/specifications`): every
// specification the anchored version declares, in the order the version folder
// walks them, each opening to its prose and the requirements it holds.
//
// A specification is presented by its identity and its seeded output path — the
// two things a reader needs to connect the document in a run workspace back to
// what declared it — and opens onto its display name, its summary, the
// `specification.md` prose, and its requirements in declaration order. The stack
// is the shared `SpecAccordion`, so it reads exactly like a case's seeded specs.
export function SuiteSpecificationsPage() {
  return (
    <SuiteDetailLayout tab="specifications">
      {({ suite }) => {
        const entries: AccordionEntry[] = suite.specifications.map((spec) => ({
          path: spec.manifest.id,
          // The right of the header carries where the rendered specification is
          // seeded in a run workspace, relative to `specs/`.
          kind: `specs/${spec.manifest.path}`,
          body: (
            <div className={styles.stack}>
              <h3 className={styles.entryTitle}>{spec.manifest.name}</h3>
              <p className={styles.note}>{spec.manifest.summary}</p>
              {spec.prose.trim() && (
                <Markdown className={styles.prose}>{spec.prose}</Markdown>
              )}
              <SuiteRequirementList specification={spec.manifest} />
            </div>
          ),
        }));
        return (
          <SpecAccordion
            entries={entries}
            emptyLabel="This version declares no specifications."
          />
        );
      }}
    </SuiteDetailLayout>
  );
}
