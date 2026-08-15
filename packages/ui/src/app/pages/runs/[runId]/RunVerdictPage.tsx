import { GradeBadge, Markdown, Panel, RatingBadge } from "@test-cabinet/ui";
import {
  RATING_META,
  formatPoints,
  overallGradeOf,
  scoreChecklist,
  worstRating,
  type ParsedWriteup,
} from "../../../data/ratings";
import { useGalleryData, type ReviewModel } from "../../../data/galleryContext";
import { useReviewModel } from "../../../data/useTestCase";
import {
  describeRunState,
  type RunStatePresentation,
} from "../../../data/runState";
import { LoadingState } from "../../../components/LoadingState";
import type { RunRecord } from "@test-cabinet/run-record";
import type { StoredReview } from "../../../../client/types";
import { useAuth } from "../../../../client/auth";
import { useRunsRuntime } from "../../../runtime/runsRuntime";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { RunReviewEditor } from "./RunReviewEditor";
import { ReviewList } from "./ReviewList";
import { ReviewChecklist } from "./ReviewChecklist";
import { AssetResultSection } from "./AssetResultSection";
import { AdversarialReplaySection } from "./AdversarialReplaySection";
import { PerformanceResultSection } from "./PerformanceResultSection";
import { RunErrataCallout } from "./RunErrataCallout";
import styles from "./RunDetailPages.module.scss";

// The note a failed run's default tab stands in place of its result: it produced
// neither a reviewable implementation nor a scored one. Catastrophic and
// timed-out runs are still publishable model signal, but from the dedicated
// Publish failures list rather than here; infrastructure failures are kept for
// inspection only. The failure reason is in the banner above this body, and the
// Events tab carries whatever timeline was recorded.
function FailureNote({ presentation }: { presentation: RunStatePresentation }) {
  return (
    <Panel>
      <p className={styles.empty}>
        {presentation.isPublishableFailure
          ? "This run produced no result. It can be published as a failure from the Publish failures list. See the failure reason above, and the Events tab for what was recorded."
          : "This run failed before producing a result, and an infrastructure failure is never published. See the failure reason above, and the Events tab for what was recorded."}
      </p>
    </Panel>
  );
}

// The run's default tab (`/runs/:runId`), which renders as one of two things.
//
// For a human-reviewed run it is the **Verdict** tab: the hand-written,
// post-implementation review — its overall rating and score, the per-domain
// ratings, the reviewer's writeup, and the per-item checklist breakdown. This is
// the default tab so a visitor reads the verdict before launching the (possibly
// broken) build on the Play tab.
//
// For a performance run it is the **Results** tab: that type is graded
// automatically (correctness gates, then the fuel a correct engine burned), so it
// carries no reviewer rating, checklist, or writeup at all — the auto-scored
// result IS the verdict, and it is the whole tab.
//
// For an adversarial run it is likewise the **Results** tab: that type is
// assessed on its match records alone — every reference opponent (baseline and
// evaluation algorithm) its controller was replayed against — so it too carries
// no reviewer verdict or checklist, and those match results are the whole tab.
export function RunVerdictPage() {
  const gallery = useGalleryData();
  const { canExecute, localIds } = gallery;
  const { account } = useAuth();
  const runtime = useRunsRuntime();
  return (
    <RunDetailLayout tab="verdict">
      {({ run, review, reviews, published }) => {
        const presentation = describeRunState(run.status.state);

        // A performance run is scored automatically, so nothing below this branch
        // — the review editor, the published verdict, the per-reviewer list —
        // applies to it. Its result is the tab.
        if (run.subject.testType === "performance") {
          return (
            <div className={styles.tabStack}>
              {presentation.isFailure ? (
                <FailureNote presentation={presentation} />
              ) : run.validation.performance ? (
                <PerformanceResultSection run={run} />
              ) : (
                // Completed, but the validator recorded no performance result —
                // there is nothing to score and no review to fall back on.
                <Panel>
                  <p className={styles.empty}>
                    This run recorded no performance result. See the Events tab
                    for what was captured.
                  </p>
                </Panel>
              )}
            </div>
          );
        }

        // An adversarial run is assessed on its match results alone — the record
        // of every reference opponent (baseline and evaluation algorithm) its
        // controller was replayed against. Like a performance run it carries no
        // reviewer verdict or checklist, so its Results tab is just those match
        // records; nothing below this branch applies.
        if (run.subject.testType === "adversarial") {
          const replay = gallery.replayResultFor(run);
          return (
            <div className={styles.tabStack}>
              {presentation.isFailure ? (
                <FailureNote presentation={presentation} />
              ) : replay && replay.replays.length > 0 ? (
                <AdversarialReplaySection run={run} />
              ) : (
                // Completed, but no match records were captured — there is nothing
                // to score and no review to fall back on.
                <Panel>
                  <p className={styles.empty}>
                    This run recorded no match results. See the Events tab for
                    what was captured.
                  </p>
                </Panel>
              )}
            </div>
          );
        }

        // The signed-in account already has its own review on this run — so the
        // editor is offered to revise it even on a run this worker did not produce
        // locally (a reviewer can correct their own published review from anywhere).
        const ownsReview =
          !!account && reviews.some((r) => r.reviewerId === account.id);
        return (
          <div className={styles.tabStack}>
            {/* Known issues recorded against this run's exact version, scoped to
              its variant — shown ahead of the review so a reviewer weighs them
              before scoring. Renders nothing when the version has no errata. */}
            <RunErrataCallout subject={run.subject} />
            {/* For an asset-generation run, the generated asset and its
              cheat-divergence signal lead the verdict (it has no Play tab).
              Renders nothing for other run types. */}
            <AssetResultSection run={run} />
            {
              // A failed run produced no reviewable result: there is no checklist to
              // complete, so the review editor never applies. Catastrophic and
              // timed-out runs are still publishable model signal, but from the
              // dedicated Publish failures list rather than here; infrastructure
              // failures are kept for inspection only. The
              // failure reason is in the banner above; the Events tab carries
              // whatever timeline was recorded.
              presentation.isFailure ? (
                <FailureNote presentation={presentation} />
              ) : // A produced, not-yet-published run the active worker owns is
              // reviewed and published here. The editor is also offered when the
              // signed-in account already has a review to revise (correcting one's
              // own review, even on a run this worker did not produce). Otherwise the
              // review shows read-only.
              canExecute && (localIds.has(run.id) || ownsReview) ? (
                <RunReviewEditor
                  run={run}
                  reviews={reviews}
                  published={published}
                  onChanged={() => runtime.requestRefresh()}
                />
              ) : (
                <ReadOnlyVerdictPanel
                  run={run}
                  review={review}
                  reviews={reviews}
                />
              )
            }
          </div>
        );
      }}
    </RunDetailLayout>
  );
}

// The read-only verdict panel and the reviews behind it. A component rather than
// an inline branch because the scoring model it renders against is now fetched
// per case (a hook), not read out of a catalog held whole in memory.
function ReadOnlyVerdictPanel({
  run,
  review,
  reviews,
}: {
  run: RunRecord;
  review: ParsedWriteup | undefined;
  reviews: StoredReview[];
}) {
  const model = useReviewModel(run.subject);
  // The scoring model arrives with the case fetch, so wait for it rather than
  // rendering a score-less verdict that then gains a score — a reviewer reading
  // "no score" for a run that has one is worse than a brief wait.
  if (model.status === "loading") {
    return <LoadingState size="section" label="Loading verdict…" />;
  }
  return (
    <Panel>
      {review ? (
        <PublishedVerdict review={review} model={model} />
      ) : (
        <p className={styles.empty}>
          No manual review has been written for this run yet.
        </p>
      )}
      {/* The individual reviews behind the aggregate verdict above, each linking
          to its own page (its full prose and per-item verdicts). Shown whenever
          the run carries any review. */}
      {reviews.length > 0 && (
        <div className={styles.reviews}>
          <h2 className={styles.checklistHeading}>
            {reviews.length} review
            {reviews.length === 1 ? "" : "s"}
          </h2>
          <ReviewList reviews={reviews} items={model.items} runId={run.id} />
        </div>
      )}
    </Panel>
  );
}

// The read-only verdict: overall rating + score up front, the per-domain ratings,
// the writeup prose, and the checklist broken down by domain. The scoring model
// (item weights + domains) is resolved from the catalog; when it is unavailable
// (a case not in this host's catalog) the score and weights are simply omitted.
//
// `showOverall` (default) leads with the overall rating + tier description + score
// headline; the single-review page omits it (`showOverall={false}`) because its
// own top section already carries that reviewer's name, rating, and score.
export function PublishedVerdict({
  review,
  model,
  showOverall = true,
}: {
  review: ParsedWriteup;
  model: ReviewModel;
  showOverall?: boolean;
}) {
  // A game jam grades its categories on the five-emoji scale and has no scoring
  // domains: its rating badge is the reviewer's whole-game overall grade, standing
  // in for the worst-across-domains rating a domain-scored case shows.
  const jam = model.items.some((it) => it.graded);
  const overallRating = jam
    ? null
    : worstRating(review.ratings.map((r) => r.rating));
  const overallGrade = jam ? overallGradeOf(review.checklist) : null;
  const haveModel = model.items.length > 0;
  const score = haveModel
    ? scoreChecklist(model.items, review.checklist)
    : null;

  // A domain's rating by domain id.
  const ratingByDomain = new Map(
    review.ratings.map((r) => [r.domain, r.rating]),
  );

  return (
    <>
      {/* Overall rating (worst across domains) and score (earned / total pts).
          Omitted on the single-review page, whose own top section already pairs
          the reviewer's name with that rating and score. */}
      {showOverall && (
        <div className={styles.verdictHeader}>
          {jam
            ? overallGrade && (
                <p className={styles.verdict}>
                  <GradeBadge status={overallGrade} />
                  <span className={styles.verdictLabel}>
                    Overall game grade
                  </span>
                </p>
              )
            : overallRating && (
                <p className={styles.verdict}>
                  <RatingBadge rating={overallRating} />
                  <span className={styles.verdictLabel}>
                    {RATING_META[overallRating].description}
                  </span>
                </p>
              )}
          {score && (
            <p className={styles.score}>
              <span className={styles.scoreValue}>
                {formatPoints(score.earned)} / {score.total}
              </span>{" "}
              <span className={styles.scoreUnit}>pts</span>
            </p>
          )}
        </div>
      )}

      {/* Per-domain ratings: the reviewer's call for each mode the case declares. */}
      {model.domains.length > 0 && (
        <div className={styles.domains}>
          <h2 className={styles.checklistHeading}>Domains</h2>
          <ul className={styles.domainList}>
            {model.domains.map((domain) => {
              const rating = ratingByDomain.get(domain.id);
              return (
                <li key={domain.id} className={styles.domainRow}>
                  <span
                    className={styles.domainName}
                    title={domain.description}
                  >
                    {domain.name}
                  </span>
                  {rating && <RatingBadge rating={rating} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* The writeup is prose typed in a textarea, so honor its line breaks
          literally rather than collapsing single newlines the CommonMark way. */}
      <Markdown breaks className={styles.writeupBody}>
        {review.body}
      </Markdown>

      {/* The reviewer's per-item checklist, grouped by domain. */}
      {review.checklist.length > 0 && (
        <ReviewChecklist model={model} verdicts={review.checklist} />
      )}
    </>
  );
}
