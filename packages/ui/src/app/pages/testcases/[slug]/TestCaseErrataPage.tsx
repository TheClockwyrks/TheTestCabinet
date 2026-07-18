import { Markdown, Panel } from "@test-cabinet/ui";
import type { ErratumSeverity } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import styles from "./TestCaseErrataPage.module.scss";

// The human-readable label for each severity, shown on the severity badge.
const SEVERITY_LABEL: Record<ErratumSeverity, string> = {
  info: "Info",
  minor: "Minor",
  major: "Major",
};

// The Errata tab (`/test-cases/:slug/errata`): known issues recorded against a
// version *after* it shipped, grouped by version (newest first). Errata let a
// problem be acknowledged without cutting a new version — a version bump would
// change the `(slug, version)` key every run is grouped by and evict the version's
// runs from its metrics — so this tab is where "known, not yet fixed" issues live.
//
// The list is case-level (every version's entries, across every variant): each
// erratum carries its own badges — severity, whether it can affect scoring, the
// variant it is scoped to, and the version it is (or will be) resolved in — so a
// reader sees the full picture without switching variants. A version with no errata
// contributes nothing (the tab only appears at all when some version records one).
export function TestCaseErrataPage() {
  return (
    <TestCaseDetailLayout tab="errata">
      {({ testCase }) => {
        if (testCase.errata.length === 0) {
          return (
            <Panel>
              <p className={styles.empty}>
                No errata have been recorded for {testCase.name}.
              </p>
            </Panel>
          );
        }
        return (
          <Panel>
            <p className={styles.intro}>
              Known issues found in a shipped version of this case, recorded so
              they can be acknowledged without a version bump (which would drop the
              version&rsquo;s existing runs from its metrics). An issue marked{" "}
              <span className={styles.scoringWord}>affects scoring</span> is one a
              reviewer should weigh when grading a run of that version.
            </p>
            {testCase.errata.map((group) => (
              <section key={group.version} className={styles.versionGroup}>
                <h2 className={styles.versionHeading}>{group.version}</h2>
                <ul className={styles.list}>
                  {group.errata.map((erratum) => (
                    <li key={erratum.id} className={styles.item}>
                      <div className={styles.itemHeader}>
                        <h3 className={styles.itemTitle}>{erratum.title}</h3>
                        <div className={styles.badges}>
                          <span
                            className={`${styles.badge} ${
                              styles[`severity-${erratum.severity}`]
                            }`}
                          >
                            {SEVERITY_LABEL[erratum.severity]}
                          </span>
                          {erratum.affectsScoring && (
                            <span
                              className={`${styles.badge} ${styles.scoring}`}
                            >
                              Affects scoring
                            </span>
                          )}
                          {erratum.resolvedIn && (
                            <span
                              className={`${styles.badge} ${styles.resolved}`}
                            >
                              Resolved in {erratum.resolvedIn}
                            </span>
                          )}
                          {erratum.variant && (
                            <span className={`${styles.badge} ${styles.variant}`}>
                              {erratum.variant}
                            </span>
                          )}
                        </div>
                      </div>
                      {erratum.date && (
                        <p className={styles.date}>Recorded {erratum.date}</p>
                      )}
                      <div className={styles.body}>
                        <Markdown>{erratum.body}</Markdown>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </Panel>
        );
      }}
    </TestCaseDetailLayout>
  );
}
