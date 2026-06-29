import { Link, useParams } from "react-router";
import type { RunRecord } from "@test-cabinet/run-record";
import { Panel } from "@test-cabinet/ui";
import { useGalleryData } from "../../../data/galleryContext";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { routes } from "../../../routes";
import { PublishedVerdict } from "./RunVerdictPage";
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
  const review = gallery
    .reviewsFor(run.id)
    .find((r) => r.reviewerId === reviewerId);

  return (
    <Panel>
      <Link to={routes.runDetail(run.id)} className={styles.backLink}>
        ← All reviews
      </Link>
      {review ? (
        <>
          <p className={styles.reviewAttribution}>
            Reviewed by <strong>{review.reviewer}</strong>
            {review.reviewedAt && (
              <span className={styles.reviewWhen}>
                {" · "}
                {formatReviewedAt(review.reviewedAt)}
              </span>
            )}
          </p>
          {/* A submitted review carries its prose, per-domain ratings, and
              per-item verdicts as separate fields — its writeup is the body, with
              no frontmatter to strip — so it maps straight onto the verdict view. */}
          <PublishedVerdict
            review={{
              ratings: review.ratings,
              checklist: review.checklist,
              body: review.writeup,
            }}
            model={gallery.reviewModelFor(run.subject)}
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

// The submission time, rendered as a plain calendar date and clock time.
function formatReviewedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
