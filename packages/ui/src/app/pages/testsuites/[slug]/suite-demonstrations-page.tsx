import styles from "./suite-detail-pages.module.scss";
import { SuiteDetailLayout } from "../../../layouts/testsuites/suite-detail-layout";
import { Panel } from "@clockwyrks/ui";

// The Demonstrations tab (`/test-cases/suites/:suiteSlug/demonstrations`): the
// short, self-contained builds the anchored version ships, each showing one
// mechanic in practice.
//
// Each presents its id, display name, summary and the specification whose
// mechanic it illustrates, which is what binds a demonstration to what it is a
// demonstration OF. Playing a demonstration's build is left to a later pass, so
// this tab tells a reader what the version holds rather than running it.
export function SuiteDemonstrationsPage() {
  return (
    <SuiteDetailLayout tab="demonstrations">
      {({ suite }) =>
        suite.demos.length === 0 ? (
          <Panel>
            <p className={styles.note}>This version ships no demonstrations.</p>
          </Panel>
        ) : (
          <div className={styles.stack}>
            {suite.demos.map((demo) => {
              const manifest = demo.manifest;
              const specification = suite.specifications.find(
                (spec) => spec.manifest.id === manifest.specification,
              );
              return (
                <Panel key={manifest.id}>
                  <div className={styles.entryHeader}>
                    <h2 className={styles.entryTitle}>{manifest.name}</h2>
                    <span className={styles.badge}>{manifest.id}</span>
                  </div>
                  <p className={styles.note}>{manifest.summary}</p>
                  <dl className={styles.facts}>
                    <dt>Demonstrates</dt>
                    <dd>
                      {specification
                        ? `${specification.manifest.name} (${manifest.specification})`
                        : manifest.specification}
                    </dd>
                  </dl>
                </Panel>
              );
            })}
          </div>
        )
      }
    </SuiteDetailLayout>
  );
}
