import { Markdown, Panel, RatingBadge } from "@test-cabinet/ui";
import {
  RATING_META,
  VERDICT_META,
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
import { AssetResultSection } from "./AssetResultSection";
import styles from "./RunDetailPages.module.scss";

// Map a verdict status to the row class that tints its marker.
const VERDICT_CLASS = {
  pass: styles.verdictPass,
  fail: styles.verdictFail,
} as const;

// The id used to group review items that belong to no declared domain.
const GENERAL = "__general__";

// Format a point weight as `1 pt` / `2 pts`.
function pts(weight: number): string {
  return `${weight} ${weight === 1 ? "pt" : "pts"}`;
}

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
      {({ run, review }) => {
        const presentation = describeRunState(run.status.state);
        return (
          <div className={styles.tabStack}>
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
                  <p className={styles.empty}>
                    {presentation.isPublishableFailure
                      ? "This run produced no result to review. It can be published as a failure from the Publish failures list. See the failure reason above, and the Events tab for what was recorded."
                      : "This run failed before producing a reviewable result, and an infrastructure failure is never published. See the failure reason above, and the Events tab for what was recorded."}
                  </p>
                </Panel>
              ) : // A produced, not-yet-published run the active worker owns is
              // reviewed and published here; published runs show their review
              // read-only.
              canExecute && localIds.has(run.id) ? (
                <RunReviewEditor
                  run={run}
                  onChanged={() => runtime.requestRefresh()}
                />
              ) : (
                (() => {
                  const model = gallery.reviewModelFor(run.subject);
                  const reviews = gallery.reviewsFor(run.id);
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
  const overall = worstRating(review.ratings.map((r) => r.rating));
  const haveModel = model.items.length > 0;
  const score = haveModel
    ? scoreChecklist(model.items, review.checklist)
    : null;

  // Item metadata by id (title + weight + domain), for the breakdown.
  const itemsById = new Map(model.items.map((item) => [item.id, item]));
  // The reviewer's verdict by item id.
  const verdictById = new Map(review.checklist.map((v) => [v.id, v]));
  // A domain's rating by domain id.
  const ratingByDomain = new Map(
    review.ratings.map((r) => [r.domain, r.rating]),
  );

  // Group items by their domain (declared order), with un-domained items last.
  const groups: { id: string; name: string; itemIds: string[] }[] = [];
  const groupIndex = new Map<string, number>();
  const ensureGroup = (id: string, name: string): number => {
    let index = groupIndex.get(id);
    if (index === undefined) {
      index = groups.length;
      groups.push({ id, name, itemIds: [] });
      groupIndex.set(id, index);
    }
    return index;
  };
  for (const domain of model.domains) ensureGroup(domain.id, domain.name);
  for (const item of model.items) {
    const id = item.domain ?? GENERAL;
    const name =
      model.domains.find((d) => d.id === item.domain)?.name ?? "General";
    groups[ensureGroup(id, name)]!.itemIds.push(item.id);
  }

  return (
    <>
      {/* Overall rating (worst across domains) and score (earned / total pts).
          Omitted on the single-review page, whose own top section already pairs
          the reviewer's name with that rating and score. */}
      {showOverall && (
        <div className={styles.verdictHeader}>
          {overall && (
            <p className={styles.verdict}>
              <RatingBadge rating={overall} />
              <span className={styles.verdictLabel}>
                {RATING_META[overall].description}
              </span>
            </p>
          )}
          {score && (
            <p className={styles.score}>
              <span className={styles.scoreValue}>
                {score.earned} / {score.total}
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
        <div className={styles.checklist}>
          <h2 className={styles.checklistHeading}>Reviewer checklist</h2>
          {groups
            .filter((group) => group.itemIds.length > 0)
            .map((group) => (
              <div key={group.id} className={styles.breakdownGroup}>
                {groups.length > 1 && (
                  <h3 className={styles.breakdownGroupHeading}>{group.name}</h3>
                )}
                <ul className={styles.checklistItems}>
                  {group.itemIds.map((itemId) => (
                    <ChecklistRow
                      key={itemId}
                      itemId={itemId}
                      item={itemsById.get(itemId)}
                      verdict={verdictById.get(itemId)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          {/* A run reviewed before the catalog carried weights (or against a case
              this host lacks) has verdicts but no grouped items; list them flat. */}
          {!haveModel &&
            review.checklist.length > 0 &&
            review.checklist.every((v) => !itemsById.has(v.id)) && (
              <ul className={styles.checklistItems}>
                {review.checklist.map((verdict) => (
                  <ChecklistRow
                    key={verdict.id}
                    itemId={verdict.id}
                    item={undefined}
                    verdict={verdict}
                  />
                ))}
              </ul>
            )}
        </div>
      )}
    </>
  );
}

function ChecklistRow({
  itemId,
  item,
  verdict,
}: {
  itemId: string;
  item: { title: string; weight: number } | undefined;
  verdict: { status: "pass" | "fail"; note?: string } | undefined;
}) {
  if (!verdict) return null;
  const label = item ? `${item.title} (${pts(item.weight)})` : itemId;
  return (
    <li className={`${styles.verdictRow} ${VERDICT_CLASS[verdict.status]}`}>
      <span className={styles.verdictStatus}>
        {VERDICT_META[verdict.status].label}
      </span>
      <span className={styles.verdictItem}>
        <span className={styles.verdictItemTitle}>{label}</span>
        {verdict.note && (
          <span className={styles.verdictNote}>{verdict.note}</span>
        )}
      </span>
    </li>
  );
}
