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
import { describeRunState } from "../../../data/runState";
import { useRunsRuntime } from "../../../runtime/runsRuntime";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { RunReviewEditor } from "./RunReviewEditor";
import { ReviewList } from "./ReviewList";
import { ReviewChecklist } from "./ReviewChecklist";
import { DebugScriptList } from "./DebugScriptList";
import { AssetResultSection } from "./AssetResultSection";
import { RunErrataCallout } from "./RunErrataCallout";
import styles from "./RunDetailPages.module.scss";

// The Verdict tab (`/runs/:runId`): the run's hand-written, post-implementation
// review — its overall rating and score, the per-domain ratings, the reviewer's
// writeup, and the per-item checklist breakdown. This is the default tab so a
// visitor reads the verdict before launching the (possibly broken) build on the
// Play tab.
export function RunVerdictPage() {
  const gallery = useGalleryData();
  const { canExecute, localIds } = gallery;
  const runtime = useRunsRuntime();
  return (
    <RunDetailLayout tab="verdict">
      {({ run, review, reviews }) => {
        const presentation = describeRunState(run.status.state);
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
            {/* An adversarial run's proof matches (its replays) live on the Proof
              tab, not here — they are the run's evidence of play, the adversarial
              analogue of proof-of-implementation media. */}
            {
              // A failed run produced no reviewable result: there is no checklist to
              // complete, so the review editor never applies. Catastrophic and
              // timed-out runs are still publishable model signal, but from the
              // dedicated Publish failures list rather than here; infrastructure
              // failures are kept for inspection only. The failure reason is in the
              // banner above; the Events tab carries whatever timeline was recorded.
              presentation.isFailure ? (
                <Panel>
                  {(() => {
                    // A run that failed the debug-API gate is Broken because its
                    // build never honored the instrumentation contract an
                    // automated-validation item required (a missing handle, a call
                    // that threw, a malformed return, or an output it never
                    // produced). Surface which scripts failed so the reviewer sees
                    // why it auto-failed rather than a bare "no result".
                    const failedScripts = (
                      run.validation.debugScripts ?? []
                    ).filter((s) => !s.ran);
                    if (failedScripts.length > 0) {
                      return (
                        <>
                          <p className={styles.empty}>
                            This run auto-failed as Broken: its build did not
                            honor the debug-API instrumentation contract the
                            case requires, so its automated validation could not
                            run. The scripts below could not complete against a
                            conformant build.
                          </p>
                          <DebugScriptList
                            scripts={run.validation.debugScripts ?? []}
                            failedOnly
                            heading="Failed debug scripts"
                          />
                        </>
                      );
                    }
                    return (
                      <p className={styles.empty}>
                        {presentation.isPublishableFailure
                          ? "This run produced no result to review. It can be published as a failure from the Publish failures list. See the failure reason above, and the Events tab for what was recorded."
                          : "This run failed before producing a reviewable result, and an infrastructure failure is never published. See the failure reason above, and the Events tab for what was recorded."}
                      </p>
                    );
                  })()}
                </Panel>
              ) : // A produced, not-yet-published run the active worker owns is
              // reviewed and published here; published runs show their review
              // read-only.
              canExecute && localIds.has(run.id) ? (
                <RunReviewEditor
                  run={run}
                  reviews={reviews}
                  onChanged={() => runtime.requestRefresh()}
                />
              ) : (
                (() => {
                  const model = gallery.reviewModelFor(run.subject);
                  return (
                    <Panel>
                      {review ? (
                        <PublishedVerdict review={review} model={model} />
                      ) : (
                        <p className={styles.empty}>
                          No manual review has been written for this run yet.
                        </p>
                      )}
                      {/* The individual reviews behind the aggregate verdict above,
                          each linking to its own page (its full prose and per-item
                          verdicts). Shown whenever the run carries any review. */}
                      {reviews.length > 0 && (
                        <div className={styles.reviews}>
                          <h2 className={styles.checklistHeading}>
                            {reviews.length} review
                            {reviews.length === 1 ? "" : "s"}
                          </h2>
                          <ReviewList
                            reviews={reviews}
                            items={model.items}
                            runId={run.id}
                          />
                        </div>
                      )}
                    </Panel>
                  );
                })()
              )
            }
          </div>
        );
      }}
    </RunDetailLayout>
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
