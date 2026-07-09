import { useMemo } from "react";
import { RatingBadge } from "@test-cabinet/ui";
import { Panel, canonicalModelId } from "@test-cabinet/ui";
import { useCaseRunSummaries } from "../../../data/useRuns";
import { useFindReview } from "../../../data/writeups";
import { useFindModel } from "../../../data/useModels";
import {
  RATINGS,
  scoreChecklist,
  worstRating,
  type Rating,
} from "../../../data/ratings";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import styles from "./TestCaseLeaderboardPage.module.scss";

// One model's best result on this case + variant.
interface Entry {
  modelId: string;
  modelName: string;
  earned: number;
  total: number;
  overall: Rating | null;
  startedAt: string;
}

// The Leaderboard tab (`/test-cases/:slug/leaderboard`): each model that has a
// scored run of the selected variant, ranked by points. A model appears once,
// represented by its best-scoring run (ties broken by the better overall rating,
// then recency). Unlike the rest of the gallery, this IS a ranking — the score is
// what it ranks on.
export function TestCaseLeaderboardPage() {
  return (
    <TestCaseDetailLayout tab="leaderboard">
      {({ testCase, variant }) => (
        <LeaderboardContent testCase={testCase} variant={variant} />
      )}
    </TestCaseDetailLayout>
  );
}

function LeaderboardContent({
  testCase,
  variant,
}: {
  testCase: TestCaseSummary;
  variant: VariantSummary;
}) {
  const { summaries, localWriteups } = useCaseRunSummaries(testCase.slug);
  const findReview = useFindReview();
  const findModel = useFindModel();

  // Best scored run per model for this case + variant, ranked by points.
  const entries = useMemo<Entry[]>(() => {
    // Score every reviewed run of this case + variant, then keep each model's best.
    const best = new Map<string, Entry>();
    for (const run of summaries) {
      if (
        run.subject.testCaseSlug !== testCase.slug ||
        run.subject.variant !== variant.slug
      ) {
        continue;
      }
      // Only a completed run can be ranked: a failed run produced no result and
      // is never reviewable, so it carries no score. (It has no review either, so
      // this also guards the scoring below.)
      if (run.state !== "completed") continue;
      const review = findReview(run.id, localWriteups);
      if (!review || review.ratings.length === 0) continue;
      const { earned, total } = scoreChecklist(
        variant.reviewItems,
        review.checklist,
      );
      const candidate: Entry = {
        // Canonicalized (harness-aware) so an `openrouter/`-prefixed or
        // `:free`-tagged run and its base form rank as one model, not two rows.
        modelId: canonicalModelId(run.subject.modelId, run.subject.harnessSlug),
        modelName:
          findModel(run.subject.modelId, run.subject.harnessSlug)?.name ??
          canonicalModelId(run.subject.modelId, run.subject.harnessSlug),
        earned,
        total,
        overall: worstRating(review.ratings.map((r) => r.rating)),
        startedAt: run.startedAt,
      };
      const current = best.get(candidate.modelId);
      if (!current || beats(candidate, current)) {
        best.set(candidate.modelId, candidate);
      }
    }
    return [...best.values()].sort(byScoreThenRatingThenRecency);
  }, [
    summaries,
    localWriteups,
    findReview,
    findModel,
    testCase.slug,
    variant.slug,
    variant.reviewItems,
  ]);

  if (entries.length === 0) {
    return (
      <section className={styles.section}>
        <Panel>
          <p className={styles.empty}>
            No scored runs of {variant.name} yet — the leaderboard ranks models
            once their runs have been reviewed.
          </p>
        </Panel>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <Panel>
        <div
          className={styles.board}
          role="table"
          aria-label="Model leaderboard"
        >
          <div
            className={`${styles.row} ${styles.head}`}
            role="row"
            aria-hidden="true"
          >
            <span className={styles.rank}>#</span>
            <span>MODEL</span>
            <span className={styles.num}>SCORE</span>
            <span>RATING</span>
          </div>
          {entries.map((entry, index) => (
            <div className={styles.row} role="row" key={entry.modelId}>
              <span className={styles.rank}>{index + 1}</span>
              <span className={styles.model}>{entry.modelName}</span>
              <span className={styles.num}>
                <span className={styles.scoreValue}>
                  {entry.earned} / {entry.total}
                </span>{" "}
                <span className={styles.scoreUnit}>pts</span>
              </span>
              <span>
                {entry.overall ? (
                  <RatingBadge rating={entry.overall} />
                ) : (
                  <span className={styles.none}>—</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

// Whether `a` is a better result than `b`: more points first, then a better
// overall rating, then the more recent run.
function beats(a: Entry, b: Entry): boolean {
  return byScoreThenRatingThenRecency(a, b) < 0;
}

// Sort comparator: points descending, then better (lower-ranked) overall rating,
// then more recent run. A null rating sorts worst.
function byScoreThenRatingThenRecency(a: Entry, b: Entry): number {
  if (a.earned !== b.earned) return b.earned - a.earned;
  const ra = a.overall ? RATINGS.indexOf(a.overall) : RATINGS.length;
  const rb = b.overall ? RATINGS.indexOf(b.overall) : RATINGS.length;
  if (ra !== rb) return ra - rb;
  return b.startedAt.localeCompare(a.startedAt);
}
