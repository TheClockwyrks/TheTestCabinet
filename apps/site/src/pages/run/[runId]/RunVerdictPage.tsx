import { Markdown } from "../../../components/Markdown";
import { Panel } from "../../../components/Panel";
import { RatingBadge } from "../../../components/RatingBadge";
import { RATING_META } from "../../../data/ratings";
import { RunDetailLayout } from "../../../layouts/run/RunDetailLayout";
import styles from "./RunDetailPages.module.scss";

// The Verdict tab (`/runs/:runId`): the run's hand-written, post-implementation
// review — its quality rating and the reviewer's writeup. This is the default
// tab so a visitor reads the verdict before launching the (possibly broken)
// build on the Play tab.
export function RunVerdictPage() {
  return (
    <RunDetailLayout tab="verdict">
      {({ review }) => (
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
            </>
          ) : (
            <p className={styles.empty}>
              No manual review has been written for this run yet.
            </p>
          )}
        </Panel>
      )}
    </RunDetailLayout>
  );
}
