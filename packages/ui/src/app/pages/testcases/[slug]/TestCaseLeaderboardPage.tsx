import { useMemo } from "react";
import { RatingBadge } from "@test-cabinet/ui";
import { Panel } from "@test-cabinet/ui";
import { useRuns } from "../../../data/useRuns";
import { useFindReview } from "../../../data/writeups";
import { findModelByModelId } from "../../../data/models";
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

// One model's failure tally on this case + variant: the count of runs that ended
// in each publishable failure tier. Kept entirely separate from the score —
// failures never enter the ranking — so a model that always fails is still
// visible here even when it has no scored run.
interface Reliability {
  modelId: string;
  modelName: string;
  catastrophic: number;
  timedOut: number;
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
  const { runs, localWriteups } = useRuns();
  const findReview = useFindReview();

  // Best scored run per model for this case + variant, ranked by points.
  const entries = useMemo<Entry[]>(() => {
    // Score every reviewed run of this case + variant, then keep each model's best.
    const best = new Map<string, Entry>();
    for (const run of runs) {
      if (
        run.subject.testCaseSlug !== testCase.slug ||
        run.subject.variant !== variant.slug
      ) {
        continue;
      }
      // Only a completed run can be ranked: a failed run produced no result and
      // is never reviewable, so it carries no score. (It has no review either, so
      // this also guards the scoring below.)
      if (run.status.state !== "completed") continue;
      const review = findReview(run.id, localWriteups);
      if (!review || review.ratings.length === 0) continue;
      const { earned, total } = scoreChecklist(
        variant.reviewItems,
        review.checklist,
      );
      const candidate: Entry = {
        modelId: run.subject.modelId,
        modelName: findModelByModelId(run.subject.modelId)?.name ?? run.subject.modelId,
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
  }, [runs, localWriteups, findReview, testCase.slug, variant.slug, variant.reviewItems]);

  // Per-model failure tally for this case + variant: how many runs ended in each
  // publishable failure tier. Tallied straight from the run state — independent
  // of the score above — so a model that only ever fails still shows here. Sorted
  // worst-first (most failures), then by name for stability.
  const reliability = useMemo<Reliability[]>(() => {
    const byModel = new Map<string, Reliability>();
    for (const run of runs) {
      if (
        run.subject.testCaseSlug !== testCase.slug ||
        run.subject.variant !== variant.slug
      ) {
        continue;
      }
      const state = run.status.state;
      if (state !== "catastrophic" && state !== "timed_out") continue;
      const modelId = run.subject.modelId;
      let row = byModel.get(modelId);
      if (!row) {
        row = {
          modelId,
          modelName: findModelByModelId(modelId)?.name ?? modelId,
          catastrophic: 0,
          timedOut: 0,
        };
        byModel.set(modelId, row);
      }
      if (state === "catastrophic") row.catastrophic += 1;
      else row.timedOut += 1;
    }
    return [...byModel.values()].sort(byFailureCountThenName);
  }, [runs, testCase.slug, variant.slug]);

  if (entries.length === 0 && reliability.length === 0) {
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
    <>
      {entries.length > 0 && (
        <section className={styles.section}>
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
        </section>
      )}

      {/* Reliability: the failures the ranking excludes, so a model that fails to
          produce a result is still visible. The score above is computed only over
          completed + reviewed runs; this is a separate, unranked tally. */}
      <ReliabilitySection variant={variant} rows={reliability} />
    </>
  );
}

// The per-model failure tally below the ranked board: catastrophic and timed-out
// run counts for this case + variant. Omitted entirely (a brief note) when no
// failures were recorded, so a clean variant reads as such.
function ReliabilitySection({
  variant,
  rows,
}: {
  variant: VariantSummary;
  rows: Reliability[];
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.reliabilityHeading}>Reliability</h2>
      {rows.length === 0 ? (
        <Panel>
          <p className={styles.empty}>
            No failures recorded for {variant.name}.
          </p>
        </Panel>
      ) : (
        <div
          className={styles.reliabilityBoard}
          role="table"
          aria-label="Model reliability"
        >
          <div
            className={`${styles.reliabilityRow} ${styles.head}`}
            role="row"
            aria-hidden="true"
          >
            <span>MODEL</span>
            <span className={styles.num}>CATASTROPHIC</span>
            <span className={styles.num}>TIMED OUT</span>
          </div>
          {rows.map((row) => (
            <div
              className={styles.reliabilityRow}
              role="row"
              key={row.modelId}
            >
              <span className={styles.model}>{row.modelName}</span>
              <span className={styles.num}>
                {row.catastrophic || <span className={styles.none}>—</span>}
              </span>
              <span className={styles.num}>
                {row.timedOut || <span className={styles.none}>—</span>}
              </span>
            </div>
          ))}
        </div>
      )}
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

// Reliability comparator: most total failures first, then by model name so the
// order is stable across renders.
function byFailureCountThenName(a: Reliability, b: Reliability): number {
  const totalA = a.catastrophic + a.timedOut;
  const totalB = b.catastrophic + b.timedOut;
  if (totalA !== totalB) return totalB - totalA;
  return a.modelName.localeCompare(b.modelName);
}
