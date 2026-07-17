import { Panel } from "@test-cabinet/ui";
import { RATINGS, RATING_META } from "../../../data/ratings";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
// The checklist body is the same component the run Verdict tab renders; here it is
// handed the case's item definitions with no verdicts, so it shows the blank
// checklist a reviewer works through rather than one run's answers.
import { ReviewChecklist } from "../../runs/[runId]/ReviewChecklist";
import styles from "./TestCaseReviewingPage.module.scss";

// The Reviewing tab (`/test-cases/:slug/reviewing`): how a run of the selected
// variant is graded, shown read-only because it is tied to no run. A reviewer
// rates each scoring domain on the five-tier scale and works the weighted
// checklist item by item; this surfaces the same three pieces — the domains, the
// rating scale, and the checklist — that the run's Verdict tab records against,
// but as the empty rubric rather than a filled-in review. The checklist itself is
// rendered by the very component the Verdict tab uses, so the two read identically.
export function TestCaseReviewingPage() {
  return (
    <TestCaseDetailLayout tab="reviewing">
      {({ variant }) => {
        const model = { items: variant.reviewItems, domains: variant.domains };
        const haveChecklist = model.items.length > 0;
        return (
          <Panel>
            <p className={styles.intro}>
              How a run of this variant is graded. A reviewer rates each scoring
              domain on the five-tier scale and works the weighted checklist
              below one item at a time. This is the rubric only — no run is
              attached, so nothing is marked.
            </p>

            {model.domains.length > 0 && (
              <section className={styles.rubric}>
                <h2 className={styles.rubricHeading}>Scoring domains</h2>
                <p className={styles.rubricNote}>
                  Each is rated independently; a run&rsquo;s overall rating is
                  the worst across them.
                </p>
                <ul className={styles.defList}>
                  {model.domains.map((domain) => (
                    <li key={domain.id} className={styles.defRow}>
                      <span className={styles.defTerm}>{domain.name}</span>
                      {domain.description && (
                        <span className={styles.defDesc}>
                          {domain.description}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {model.domains.length > 0 && (
              <section className={styles.rubric}>
                <h2 className={styles.rubricHeading}>Rating scale</h2>
                <ul className={styles.defList}>
                  {RATINGS.map((rating) => (
                    <li key={rating} className={styles.defRow}>
                      <span className={styles.defTerm}>
                        {RATING_META[rating].label}
                      </span>
                      <span className={styles.defDesc}>
                        {RATING_META[rating].description}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {haveChecklist ? (
              <ReviewChecklist model={model} />
            ) : (
              <p className={styles.empty}>
                No reviewer checklist is published for this variant.
              </p>
            )}
          </Panel>
        );
      }}
    </TestCaseDetailLayout>
  );
}
