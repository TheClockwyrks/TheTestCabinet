import { GradeBadge, Markdown, Panel, RatingBadge } from "@test-cabinet/ui";
import {
  GRADE_META,
  GRADE_MAX_POINTS,
  RATING_META,
  VERDICT_META,
  formatPoints,
  isGrade,
  overallGradeOf,
  scoreChecklist,
  subItemVerdictId,
  worstRating,
  type ParsedWriteup,
  type VerdictStatus,
} from "../../../data/ratings";
import type { ReviewItemSummary } from "../../../data/testCases";
import { useGalleryData, type ReviewModel } from "../../../data/galleryContext";
import {
  describeRunState,
  type RunStatePresentation,
} from "../../../data/runState";
import { useRunsRuntime } from "../../../runtime/runsRuntime";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { RunReviewEditor } from "./RunReviewEditor";
import { ReviewList } from "./ReviewList";
import { AssetResultSection } from "./AssetResultSection";
import { PerformanceResultSection } from "./PerformanceResultSection";
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
export function RunVerdictPage() {
  const gallery = useGalleryData();
  const { canExecute, localIds } = gallery;
  const runtime = useRunsRuntime();
  return (
    <RunDetailLayout tab="verdict">
      {({ run, review, reviews }) => {
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
                <FailureNote presentation={presentation} />
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
                  {group.itemIds.map((itemId, i) => {
                    const item = itemsById.get(itemId);
                    // Top-level items are numbered within their group (their
                    // sub-items are lettered a, b, c… beneath).
                    const number = i + 1;
                    // An item graded per sub-item shows its title as a heading
                    // with one nested pass/fail row per sub-item; a whole-item
                    // item is a single row keyed by its own id.
                    if (item && (item.subItems?.length ?? 0) > 0) {
                      return (
                        <ChecklistItemGroup
                          key={itemId}
                          number={number}
                          item={item}
                          verdictById={verdictById}
                        />
                      );
                    }
                    return (
                      <ChecklistRow
                        key={itemId}
                        number={number}
                        title={item ? item.title : itemId}
                        weight={item ? item.weight : undefined}
                        graded={item?.graded}
                        verdict={verdictById.get(itemId)}
                      />
                    );
                  })}
                </ul>
              </div>
            ))}
          {/* A run reviewed before the catalog carried weights (or against a case
              this host lacks) has verdicts but no grouped items; list them flat. */}
          {!haveModel &&
            review.checklist.length > 0 &&
            review.checklist.every((v) => !itemsById.has(v.id)) && (
              <ul className={styles.checklistItems}>
                {review.checklist.map((verdict, i) => (
                  <ChecklistRow
                    key={verdict.id}
                    number={i + 1}
                    title={verdict.id}
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

// A sub-itemed review item in the read-only breakdown. Because a sub-itemed item
// has no single verdict, its header stands a passed/total tally in the same status
// gutter the Pass/Fail markers use, so the item still reads as a graded line
// aligned with the whole-item rows around it (rather than a badge-less heading
// that looks misplaced). Beneath it, one nested pass/fail row per sub-item
// (lettered a, b, c…), each keyed by the composite `<item>.<sub>` verdict id.
function ChecklistItemGroup({
  number,
  item,
  verdictById,
}: {
  number: number;
  item: ReviewItemSummary;
  verdictById: Map<string, { status: VerdictStatus; note?: string }>;
}) {
  const subItems = item.subItems ?? [];
  // Only sub-items the reviewer actually graded render a row; the tally counts
  // over exactly those so it matches the rows shown. Sub-items are always
  // pass/fail (a graded game-jam category has no sub-items).
  const graded = subItems
    .map((sub) => verdictById.get(subItemVerdictId(item.id, sub.id)))
    .filter((v): v is { status: VerdictStatus; note?: string } => !!v);
  if (graded.length === 0) return null;
  const passed = graded.filter((v) => v.status === "pass").length;
  return (
    <li className={styles.verdictItemGroup}>
      <span className={styles.verdictGroupHeader}>
        <span className={styles.verdictGroupTally}>
          {passed}/{graded.length}
        </span>
        <span className={styles.verdictItemGroupTitle}>
          {number}. {item.title}{" "}
          <span className={styles.verdictWeight}>({pts(item.weight)})</span>
        </span>
      </span>
      <ul className={styles.checklistSubItems}>
        {subItems.map((sub, i) => (
          <ChecklistRow
            key={sub.id}
            title={`${String.fromCharCode(97 + i)}. ${sub.title}`}
            verdict={verdictById.get(subItemVerdictId(item.id, sub.id))}
          />
        ))}
      </ul>
    </li>
  );
}

// One checklist line: the marker in the fixed status gutter beside the item text.
// A binary item shows its Pass/Fail label tinted by the verdict; a graded game-jam
// category shows the grade emoji instead. `number`, on a top-level whole-item,
// prefixes the title (sub-item rows are lettered in their `title` instead and pass
// none). `weight`, when given, trails the title dimmed as its point value — a flat
// weight for a binary item, `earned / available` for a graded one; a reviewer's
// note stacks beneath the title on its own line.
function ChecklistRow({
  number,
  title,
  weight,
  graded,
  verdict,
}: {
  number?: number;
  title: string;
  weight?: number;
  graded?: boolean;
  verdict: { status: VerdictStatus; note?: string } | undefined;
}) {
  if (!verdict) return null;
  const status = verdict.status;
  const grade = isGrade(status) ? GRADE_META[status] : null;
  const rowClass = grade
    ? styles.verdictGraded
    : VERDICT_CLASS[status as "pass" | "fail"];
  const marker = grade ? grade.emoji : VERDICT_META[status].label;
  const pointsLabel =
    weight === undefined
      ? null
      : graded
        ? `${grade ? grade.points * weight : 0} / ${weight * GRADE_MAX_POINTS} pts`
        : pts(weight);
  return (
    <li className={`${styles.verdictRow} ${rowClass}`}>
      <span className={styles.verdictStatus}>{marker}</span>
      <span className={styles.verdictItem}>
        <span className={styles.verdictItemTitle}>
          {number !== undefined && `${number}. `}
          {title}
          {pointsLabel && (
            <>
              {" "}
              <span className={styles.verdictWeight}>({pointsLabel})</span>
            </>
          )}
        </span>
        {verdict.note && (
          <span className={styles.verdictNote}>{verdict.note}</span>
        )}
      </span>
    </li>
  );
}
