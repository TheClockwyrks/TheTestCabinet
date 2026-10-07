import { Link, useParams } from "react-router";
import type { RunRecord } from "@clockwyrks/run-record";
import type { StoredReview } from "../../../../client/types";
import { Markdown, Panel } from "@clockwyrks/ui";
import { useAuth } from "../../../../client/auth";
import { useGalleryData } from "../../../data/galleryContext";
import { useReviewModel } from "../../../data/useRunVariant";
import {
  VERDICT_META,
  automatedVerdicts,
  isToolchainGated,
  overallGradeOf,
  reviewAesthetic,
  scoreChecklist,
  validatorReviewRating,
  validatorReviewScore,
  verdictIdsForItem,
  worstRating,
} from "../../../data/ratings";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { routes } from "../../../routes";
import { PublishedVerdict } from "./RunVerdictPage";
import { ReviewHeader } from "./ReviewList";
import { ReviewHistory } from "./ReviewHistory";
import styles from "./RunDetailPages.module.scss";

// One reviewer's full review (`/runs/:runId/reviews/:reviewerId`): their writeup
// and the per-item verdicts they recorded, attributed to its author. Linked to
// from the Verdict tab's review list so a reviewer can read exactly what another
// reviewer (or their own earlier self) said for every checklist item. Rendered
// under the same run chrome as the Verdict tab, which it belongs to.
export function RunReviewPage() {
  return (
    <RunDetailLayout tab="verdict">
      {({ run, reviews, validatorRated }) =>
        // A performance run is graded automatically and carries no review, so no
        // review list links here for one. The route still resolves, though — a
        // stale link or a review recorded before the type went auto-graded — so
        // say why there is nothing to show rather than rendering an empty
        // reviewer shell.
        run.subject.testType === "performance" ? (
          <Panel>
            <div className={styles.reviewTopBar}>
              <Link to={routes.runVerdict(run.id)} className={styles.backLink}>
                ← Results
              </Link>
            </div>
            <p className={styles.empty}>
              A performance run is graded automatically on correctness and fuel,
              so it carries no reviews. See the Results tab for its score.
            </p>
          </Panel>
        ) : (
          <SingleReview
            run={run}
            reviews={reviews}
            validatorRated={validatorRated}
          />
        )
      }
    </RunDetailLayout>
  );
}

function SingleReview({
  run,
  reviews,
  validatorRated,
}: {
  run: RunRecord;
  reviews: StoredReview[];
  /** Whether the run is validator-rated: this review then carries the run-wide
   * aesthetic tier, its verdict overrides (if any), and prose — the figures in
   * its header fold the overrides into the validators' verdicts. */
  validatorRated: boolean;
}) {
  const { reviewerId } = useParams<{ reviewerId: string }>();
  const gallery = useGalleryData();
  const { account } = useAuth();
  const review = reviews.find((r) => r.reviewerId === reviewerId);
  const model = useReviewModel(run.subject);

  // The overall rating (worst across domains) or, for a game jam, the whole-game
  // overall grade — plus the score — for the top section's header, mirroring how
  // the review list summarizes each review. A jam has no domains, so its grade
  // badge stands in for the rating. On a validator-rated run the figures are the
  // review's EFFECTIVE ones: the validators' verdicts overlaid with this
  // review's overrides.
  const jam = model.items.some((it) => it.graded);
  const gated = isToolchainGated(run.toolchain);
  const auto = validatorRated
    ? automatedVerdicts(run.validation.debugScripts ?? [])
    : [];
  const overall = review
    ? validatorRated
      ? model.items.length > 0
        ? validatorReviewRating(
            gated,
            model.domains,
            model.items,
            auto,
            review.checklist,
          )
        : null
      : !jam
        ? worstRating(review.ratings.map((r) => r.rating))
        : null
    : null;
  const aesthetic = review ? reviewAesthetic(review) : null;
  const grade = review && jam ? overallGradeOf(review.checklist) : null;
  const score =
    review && model.items.length > 0
      ? validatorRated
        ? validatorReviewScore(gated, model.items, auto, review.checklist)
        : scoreChecklist(model.items, review.checklist)
      : null;

  // The Edit control belongs only on the signed-in account's own review, wherever a
  // console that can execute can submit it — the reviewer can correct their own
  // review even on a run this worker did not produce locally (the same gate the
  // Verdict tab uses). It returns to the Verdict tab with the form reopened.
  const isOwn = !!account && review?.reviewerId === account.id;
  const canEdit = isOwn && gallery.canExecute;

  return (
    <Panel>
      <div className={styles.reviewTopBar}>
        <Link to={routes.runVerdict(run.id)} className={styles.backLink}>
          ← All reviews
        </Link>
        {canEdit && (
          <Link
            to={routes.runVerdict(run.id, { edit: true })}
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
              reviewerPictureUrl={review.reviewerPictureUrl}
              rating={overall}
              aesthetic={aesthetic}
              grade={grade}
              reviewedAt={review.reviewedAt}
              editedAt={review.editedAt}
              score={score}
            />
          </div>
          {/* A submitted review carries its prose, per-domain ratings, and
              per-item verdicts as separate fields — its writeup is the body, with
              no frontmatter to strip — so it maps straight onto the verdict view.
              The overall headline is suppressed here; the top section above already
              carries this reviewer's rating and score. */}
          {validatorRated ? (
            // The review's run-wide aesthetic tier is in the header above; here,
            // the reviewer's verdict overrides (if any) and their prose. The
            // full checklist is the validators' and lives on the Verdict tab.
            <>
              <ValidatorOverrides
                review={review}
                run={run}
                items={model.items}
              />
              <Markdown breaks className={styles.writeupBody}>
                {review.writeup}
              </Markdown>
            </>
          ) : (
            <PublishedVerdict
              review={{
                ratings: review.ratings,
                aesthetic: null,
                checklist: review.checklist,
                body: review.writeup,
              }}
              model={model}
              showOverall={false}
            />
          )}
          {/* The review's edit history, if it has been revised — each edit's note
              and the autogenerated diff of what changed. Renders nothing otherwise. */}
          <ReviewHistory revisions={review.revisions} />
        </>
      ) : (
        <p className={styles.empty}>
          No review by this reviewer was found for this run.
        </p>
      )}
    </Panel>
  );
}

// A validator-rated review's verdict OVERRIDES, listed point by point: the point
// in the reviewer's vocabulary (category › title), what the validators said, what
// the reviewer decided, and their note. Renders nothing for a review with no
// overrides — the common case, where the validators' verdicts stand untouched.
function ValidatorOverrides({
  review,
  run,
  items,
}: {
  review: StoredReview;
  run: RunRecord;
  items: ReturnType<typeof useReviewModel>["items"];
}) {
  const overrides = review.checklist;
  if (overrides.length === 0) return null;

  // The validators' own verdicts, to show what each override replaced.
  const autoById = new Map(
    automatedVerdicts(run.validation.debugScripts ?? []).map((v) => [
      v.id,
      v.status,
    ]),
  );
  // Verdict id → the point's own title and category, so a row reads
  // "Rules › Ball serves" rather than the raw `rules.serve`.
  const labels = new Map<string, { title: string; category: string }>();
  for (const item of items) {
    const subItems = item.subItems ?? [];
    verdictIdsForItem(item).forEach((vid, i) => {
      labels.set(vid, {
        title: subItems[i]?.title ?? item.title,
        category: subItems.length > 0 ? item.title : "",
      });
    });
  }

  return (
    <div className={styles.overrides}>
      <h2 className={styles.checklistHeading}>
        Overridden verdicts ({overrides.length})
      </h2>
      <ul className={styles.overrideList}>
        {overrides.map((verdict) => {
          const label = labels.get(verdict.id);
          const from = autoById.get(verdict.id);
          return (
            <li key={verdict.id} className={styles.overrideRow}>
              <span className={styles.overridePoint}>
                {label?.category && (
                  <span className={styles.overrideCategory}>
                    {label.category} ›{" "}
                  </span>
                )}
                {label?.title ?? verdict.id}
              </span>
              <span className={styles.overrideFlip}>
                <span className={styles.overrideFrom}>
                  {from ? VERDICT_META[from].label : "Undecided"}
                </span>
                <span aria-hidden="true"> → </span>
                <span className={styles.overrideTo}>
                  {VERDICT_META[verdict.status].label}
                </span>
              </span>
              {verdict.note && (
                <span className={styles.overrideNote}>{verdict.note}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
