import styles from "./suite-detail-pages.module.scss";
import { ReferenceBuildList } from "../../../components/PlayableEmbed";
import { SuiteDetailLayout } from "../../../layouts/testsuites/suite-detail-layout";
import { Panel } from "@clockwyrks/ui";

// The Reference implementations tab
// (`/test-cases/suites/:suiteSlug/reference-implementations`): the engines the
// anchored version ships a hand-curated, correct implementation for.
//
// A suite holds at most one reference implementation per engine and at least one
// across all of them, and every one passes every validator the suite declares.
// Each engine is one entry: one with an uploaded build plays it inline, the way a
// case variant's reference build plays, and one with no upload is listed without a
// play action.
export function SuiteReferencesPage() {
  return (
    <SuiteDetailLayout tab="references">
      {({ suite }) =>
        suite.referenceImplementations.length === 0 &&
        Object.keys(suite.referenceBuilds).length === 0 ? (
          <Panel>
            <p className={styles.note}>
              This version ships no reference implementation.
            </p>
          </Panel>
        ) : (
          <Panel>
            <ReferenceBuildList
              key={`${suite.slug}@${suite.version}`}
              engines={suite.referenceImplementations}
              builds={suite.referenceBuilds}
              subject={`${suite.suite.name} ${suite.version}`}
            />
          </Panel>
        )
      }
    </SuiteDetailLayout>
  );
}
