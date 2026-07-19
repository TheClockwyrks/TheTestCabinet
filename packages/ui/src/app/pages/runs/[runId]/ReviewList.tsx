import { Link } from "react-router";
import { Avatar, GradeBadge, RatingBadge } from "@test-cabinet/ui";
import {
  formatPoints,
  overallGradeOf,
  scoreChecklist,
  worstRating,
  type GradeStatus,
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
  // A game jam's card badge is the reviewer's whole-game overall grade (its
  // categories are graded, and it has no scoring domains), in place of the
  // worst-across-domains rating a domain-scored case shows.
  const jam = items.some((it) => it.graded);
  return (
    <ul className={styles.reviewList}>
      {reviews.map((review) => {
        const overall = jam
          ? null
          : worstRating(review.ratings.map((r) => r.rating));
        const grade = jam ? overallGradeOf(review.checklist) : null;
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
                  reviewerPictureUrl={review.reviewerPictureUrl}
                  rating={overall}
                  grade={grade}
                  reviewedAt={review.reviewedAt}
                  editedAt={review.editedAt}
                  score={score}
                />
                {snippet && <p className={styles.reviewSnippet}>{snippet}</p>}
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
  reviewerPictureUrl,
  rating,
  grade,
  reviewedAt,
  editedAt,
  score,
}: {
  reviewer: string;
  // The reviewer's avatar URL, shown beside their name; falls back to initials when
  // absent or the picture 404s (the reviewer has no picture).
  reviewerPictureUrl?: string | null;
  rating: Rating | null;
  // A game-jam review's whole-game overall grade, shown as the badge in place of
  // the per-domain `rating` a jam does not carry. Null/absent for a domain-scored
  // review.
  grade?: GradeStatus | null;
  reviewedAt?: string | null;
  // When the review was last edited, if ever — surfaced as an "edited" marker beside
  // the submission time so a reader knows the review was revised.
  editedAt?: string | null;
  score: Score | null;
}) {
  return (
    <div className={styles.reviewHeader}>
      <div className={styles.reviewHeaderRow}>
        <span className={styles.reviewAuthor}>
          <Avatar
            name={reviewer}
            pictureUrl={reviewerPictureUrl}
            size={20}
            className={styles.reviewAvatar}
          />
          {reviewer}
        </span>
        {grade ? (
          <GradeBadge status={grade} />
        ) : (
          rating && <RatingBadge rating={rating} />
        )}
      </div>
      {(reviewedAt || score) && (
        <div className={styles.reviewHeaderRow}>
          <span className={styles.reviewWhen}>
            {reviewedAt ? formatReviewedAt(reviewedAt) : ""}
            {editedAt && (
              <span
                className={styles.reviewEdited}
                title={`Edited ${formatReviewedAt(editedAt)}`}
              >
                {" · edited"}
              </span>
            )}
          </span>
          {score && (
            <span className={styles.reviewScore}>
              {formatPoints(score.earned)} / {score.total} pts
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
