import { Link } from "react-router";
import { RatingBadge } from "@test-cabinet/ui";
import {
  scoreChecklist,
  worstRating,
  type Rating,
  type Score,
  type WeightedItem,
} from "../../../data/ratings";
import type { StoredReview } from "../../../../client/types";
import { routes } from "../../../routes";
import styles from "./ReviewList.module.scss";

// A run's individual reviews as compact, clickable cards — author and overall
// rating on the first line, the review's timestamp and score on the second, and a
// few lines of its writeup beneath — each linking to that review's own page (its
// full prose and per-item verdicts). Shared by the Verdict tab's editor (above the
// form) and its read-only published view.
//
// Scoring uses the case's declared `items`; pass an empty list when the scoring
// model is unavailable and the per-review score is simply omitted.
export function ReviewList({
  reviews,
  items,
  runId,
}: {
  reviews: StoredReview[];
  items: readonly WeightedItem[];
  runId: string;
}) {
  return (
    <ul className={styles.reviewList}>
      {reviews.map((review) => {
        const overall = worstRating(review.ratings.map((r) => r.rating));
        const score =
          items.length > 0 ? scoreChecklist(items, review.checklist) : null;
        // The leading lines of the writeup as a preview, clamped to a few lines
        // with an ellipsis; the full prose lives on the review's own page.
        const snippet = review.writeup.trim();
        return (
          <li key={review.reviewerId || review.reviewer}>
            <Link
              to={routes.runReview(runId, review.reviewerId)}
              className={styles.reviewLink}
            >
              <div className={styles.reviewBody}>
                <ReviewHeader
                  reviewer={review.reviewer}
                  rating={overall}
                  reviewedAt={review.reviewedAt}
                  score={score}
                />
                {snippet && (
                  <p className={styles.reviewSnippet}>{snippet}</p>
                )}
              </div>
              {/* Marks the card as navigable — it opens the review's own page. */}
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// The two-row header shared by a review card and the single-review page's top
// section: the reviewer's name beside their overall rating, then the review's
// timestamp beside its score. Each row spreads its pair to opposite edges.
export function ReviewHeader({
  reviewer,
  rating,
  reviewedAt,
  score,
}: {
  reviewer: string;
  rating: Rating | null;
  reviewedAt?: string | null;
  score: Score | null;
}) {
  return (
    <div className={styles.reviewHeader}>
      <div className={styles.reviewHeaderRow}>
        <span className={styles.reviewAuthor}>{reviewer}</span>
        {rating && <RatingBadge rating={rating} />}
      </div>
      {(reviewedAt || score) && (
        <div className={styles.reviewHeaderRow}>
          <span className={styles.reviewWhen}>
            {reviewedAt ? formatReviewedAt(reviewedAt) : ""}
          </span>
          {score && (
            <span className={styles.reviewScore}>
              {score.earned} / {score.total} pts
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// A review's submission time as a plain calendar date and clock time.
export function formatReviewedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
