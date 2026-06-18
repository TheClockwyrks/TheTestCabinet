import { Markdown, Panel, RatingBadge } from "@test-cabinet/ui";
import { RATING_META, VERDICT_META } from "../../../data/ratings";
import { useGalleryData } from "../../../data/galleryContext";
import { useRuns } from "../../../data/useRuns";
import { useRunsRuntime } from "../../../runtime/runsRuntime";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { RunReviewEditor } from "./RunReviewEditor";
import styles from "./RunDetailPages.module.scss";

// Map a verdict status to the row class that tints its marker.
const VERDICT_CLASS = {
  pass: styles.verdictPass,
  fail: styles.verdictFail,
  na: styles.verdictNa,
} as const;

// The Verdict tab (`/runs/:runId`): the run's hand-written, post-implementation
// review — its quality rating and the reviewer's writeup. This is the default
// tab so a visitor reads the verdict before launching the (possibly broken)
// build on the Play tab.
export function RunVerdictPage() {
  const { canExecute } = useGalleryData();
  const { localIds } = useRuns();
  const runtime = useRunsRuntime();
  return (
    <RunDetailLayout tab="verdict">
      {({ run, review }) =>
        // A produced, not-yet-published run the active worker owns is reviewed
        // and published here; published runs show their review read-only.
        canExecute && localIds.has(run.id) ? (
          <RunReviewEditor
            runId={run.id}
            review={review}
            onChanged={() => runtime.requestRefresh()}
          />
        ) : (
        <Panel>
          {review ? (
            <>
              {review.rating && (
                <p className={styles.verdict}>
                  <RatingBadge rating={review.rating} />
                  <span className={styles.verdictLabel}>
                    {RATING_META[review.rating].description}
                  </span>
                </p>
              )}
              <Markdown className={styles.writeupBody}>{review.body}</Markdown>
              {review.checklist.length > 0 && (
                <div className={styles.checklist}>
                  <h2 className={styles.checklistHeading}>Reviewer checklist</h2>
                  <ul className={styles.checklistItems}>
                    {review.checklist.map((verdict) => (
                      <li
                        key={verdict.id}
                        className={`${styles.verdictRow} ${VERDICT_CLASS[verdict.status]}`}
                      >
                        <span className={styles.verdictStatus}>
                          {VERDICT_META[verdict.status].label}
                        </span>
                        <span className={styles.verdictItem}>
                          {verdict.id}
                          {verdict.note && (
                            <span className={styles.verdictNote}> — {verdict.note}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className={styles.empty}>
              No manual review has been written for this run yet.
            </p>
          )}
        </Panel>
        )
      }
    </RunDetailLayout>
  );
}
