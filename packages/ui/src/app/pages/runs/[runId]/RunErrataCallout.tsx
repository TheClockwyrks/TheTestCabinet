import { Markdown, Panel } from "@test-cabinet/ui";
import type { ErratumSeverity } from "../../../data/testCases";
import { useTestCases } from "../../../data/useTestCases";
import styles from "./RunErrataCallout.module.scss";

const SEVERITY_LABEL: Record<ErratumSeverity, string> = {
  info: "Info",
  minor: "Minor",
  major: "Major",
};

// The subset of a run's subject this callout keys off: the case, version, and
// variant a run was produced against. Errata are recorded per version, so a run's
// known issues are exactly its version's errata scoped to its variant.
interface RunErrataCalloutSubject {
  testCaseSlug: string;
  testCaseVersion: string;
  variant: string;
}

// "Known errata for this version" — the scoring-integrity surface. A run is scored
// against a specific `(case, version)`, and errata record problems found in that
// version *after* it shipped (so it need not be re-versioned, which would evict the
// run from the version's metrics). Surfacing them on the run means a reviewer sees
// the known issues before grading, rather than penalising a model for a problem the
// case owner already knows about. Resolved from the catalog by the run's version and
// filtered to its variant; renders nothing when the version has no applicable errata
// (the common case), so it is safe to mount unconditionally.
export function RunErrataCallout({
  subject,
}: {
  subject: RunErrataCalloutSubject;
}) {
  const { testCases } = useTestCases();
  const testCase = testCases.find((tc) => tc.slug === subject.testCaseSlug);
  const group = testCase?.errata.find(
    (entry) => entry.version === subject.testCaseVersion,
  );
  // A case-wide erratum (no variant) applies to every variant; a scoped one only to
  // its own.
  const applicable = (group?.errata ?? []).filter(
    (erratum) =>
      erratum.variant == null || erratum.variant === subject.variant,
  );
  if (applicable.length === 0) {
    return null;
  }
  return (
    <Panel className={styles.callout}>
      <h2 className={styles.heading}>
        Known errata for {subject.testCaseVersion}
      </h2>
      <p className={styles.note}>
        Issues found in this version after it shipped. Weigh them when scoring —
        an issue marked <span className={styles.scoringWord}>affects scoring</span>{" "}
        is a known defect a run should not be penalised for.
      </p>
      <ul className={styles.list}>
        {applicable.map((erratum) => (
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
                  <span className={`${styles.badge} ${styles.scoring}`}>
                    Affects scoring
                  </span>
                )}
                {erratum.resolvedIn && (
                  <span className={`${styles.badge} ${styles.resolved}`}>
                    Resolved in {erratum.resolvedIn}
                  </span>
                )}
              </div>
            </div>
            <div className={styles.body}>
              <Markdown>{erratum.body}</Markdown>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
