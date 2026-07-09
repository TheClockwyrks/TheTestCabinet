import { Link, useParams } from "react-router";
import type { RunRecord } from "@test-cabinet/run-record";
import { Panel } from "@test-cabinet/ui";
import { useAuth } from "../../../../client/auth";
import { useGalleryData } from "../../../data/galleryContext";
import { scoreChecklist, worstRating } from "../../../data/ratings";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { routes } from "../../../routes";
import { PublishedVerdict } from "./RunVerdictPage";
import { ReviewHeader } from "./ReviewList";
import styles from "./RunDetailPages.module.scss";

// One reviewer's full review (`/runs/:runId/reviews/:reviewerId`): their writeup
// and the per-item verdicts they recorded, attributed to its author. Linked to
// from the Verdict tab's review list so a reviewer can read exactly what another
// reviewer (or their own earlier self) said for every checklist item. Rendered
// under the same run chrome as the Verdict tab, which it belongs to.
export function RunReviewPage() {
  return (
    <RunDetailLayout tab="verdict">
      {({ run }) => <SingleReview run={run} />}
    </RunDetailLayout>
  );
}

function SingleReview({ run }: { run: RunRecord }) {
  const { reviewerId } = useParams<{ reviewerId: string }>();
  const gallery = useGalleryData();
  const { account } = useAuth();
  const { localIds } = gallery;
  const review = gallery
    .reviewsFor(run.id)
    .find((r) => r.reviewerId === reviewerId);
  const model = gallery.reviewModelFor(run.subject);

  // The overall rating (worst across domains) and score for the top section's
  // header, mirroring how the review list summarizes each review.
  const overall = review ? worstRating(review.ratings.map((r) => r.rating)) : null;
  const score =
    review && model.items.length > 0
      ? scoreChecklist(model.items, review.checklist)
      : null;

  // The Edit control belongs only on the signed-in account's own review, and only
  // where that review can actually be revised: the editor is offered for a run
  // this worker owns locally (the same gate the Verdict tab uses). It returns here
  // to the Verdict tab with the review form reopened.
  const isOwn = !!account && review?.reviewerId === account.id;
  const canEdit = isOwn && gallery.canExecute && localIds.has(run.id);

  return (
    <Panel>
      <div className={styles.reviewTopBar}>
        <Link to={routes.runDetail(run.id)} className={styles.backLink}>
          ← All reviews
        </Link>
        {canEdit && (
          <Link
            to={routes.runDetail(run.id, { edit: true })}
            className={styles.editReviewLink}
          >
            Edit review
          </Link>
        )}
      </div>
      {review ? (
        <>
          {/* The top section mirrors a review list card: the reviewer's name and
              rating over the review's timestamp and score. */}
          <div className={styles.reviewTop}>
            <ReviewHeader
              reviewer={review.reviewer}
              rating={overall}
              reviewedAt={review.reviewedAt}
              score={score}
            />
          </div>
          {/* A submitted review carries its prose, per-domain ratings, and
              per-item verdicts as separate fields — its writeup is the body, with
              no frontmatter to strip — so it maps straight onto the verdict view.
              The overall headline is suppressed here; the top section above already
              carries this reviewer's rating and score. */}
          <PublishedVerdict
            review={{
              ratings: review.ratings,
              checklist: review.checklist,
              body: review.writeup,
            }}
            model={model}
            showOverall={false}
          />
        </>
      ) : (
        <p className={styles.empty}>
          No review by this reviewer was found for this run.
        </p>
      )}
    </Panel>
  );
}
