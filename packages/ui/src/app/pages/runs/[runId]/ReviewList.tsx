import { Link } from "react-router";
import { RatingBadge } from "@test-cabinet/ui";
import {
  scoreChecklist,
  worstRating,
  type WeightedItem,
} from "../../../data/ratings";
import type { StoredReview } from "../../../../client/types";
import { routes } from "../../../routes";
import styles from "./ReviewList.module.scss";

// A run's individual reviews as compact rows — author, the review's own rating
// and score, and a one-line preview of its writeup — each linking to that
// review's own page (its full prose and per-item verdicts). Shared by the Verdict
// tab's editor (above the form, where the active account's own review carries an
// Edit control) and its read-only published view (listed, not editable).
//
// Scoring uses the case's declared `items`; pass an empty list when the scoring
// model is unavailable and the per-row score is simply omitted. `ownReviewerId`
// + `onEdit` are the editor's affordance for revising one's own review; omit them
// (the default) for a read-only listing.
export function ReviewList({
  reviews,
  items,
  runId,
  ownReviewerId = null,
  onEdit,
}: {
  reviews: StoredReview[];
  items: readonly WeightedItem[];
  runId: string;
  ownReviewerId?: string | null;
  onEdit?: () => void;
}) {
  return (
    <ul className={styles.reviewList}>
      {reviews.map((review) => {
        const overall = worstRating(review.ratings.map((r) => r.rating));
        const score =
          items.length > 0 ? scoreChecklist(items, review.checklist) : null;
        // The first non-empty line of the writeup, as a one-line preview; the
        // full prose (with its line breaks honored) lives on the review's page.
        const snippet =
          review.writeup.split(/\r?\n/).find((line) => line.trim()) ?? "";
        const isOwn = !!ownReviewerId && review.reviewerId === ownReviewerId;
        return (
          <li
            key={review.reviewerId || review.reviewer}
            className={styles.reviewRow}
          >
            <Link
              to={routes.runReview(runId, review.reviewerId)}
              className={styles.reviewLink}
            >
              <span className={styles.reviewAuthor}>{review.reviewer}</span>
              {overall && <RatingBadge rating={overall} />}
              {score && (
                <span className={styles.reviewScore}>
                  {score.earned} / {score.total} pts
                </span>
              )}
              {snippet && (
                <span className={styles.reviewSnippet}>{snippet.trim()}</span>
              )}
            </Link>
            {isOwn && onEdit && (
              <button
                type="button"
                className={styles.reviewEdit}
                onClick={onEdit}
              >
                Edit
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
