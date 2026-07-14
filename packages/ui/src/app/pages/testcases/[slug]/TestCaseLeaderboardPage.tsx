import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { RatingBadge } from "@test-cabinet/ui";
import { Panel, canonicalModelId } from "@test-cabinet/ui";
import { useCaseRunSummaries } from "../../../data/useRuns";
import { useFindReview } from "../../../data/writeups";
import { useFindModel } from "../../../data/useModels";
import {
  RATINGS,
  scoreChecklist,
  worstRating,
  type ParsedWriteup,
  type Rating,
} from "../../../data/ratings";
import type { TestCaseSummary, VariantSummary } from "../../../data/testCases";
import { TestCaseDetailLayout } from "../../../layouts/testcases/TestCaseDetailLayout";
import {
  ColumnMenu,
  type ColumnMenuHandle,
} from "../../../components/ColumnMenu";
import { useColumnVisibility } from "../../../components/useColumnVisibility";
import { formatCompact, formatUsd, totalTokens } from "../../../format";
import styles from "./TestCaseLeaderboardPage.module.scss";

// One model's aggregate result on this case + variant, folded across ALL of its
// scored runs (not just its single best). The score/rating extremes and the
// cost/token means are what the configurable columns render.
interface Entry {
  modelId: string;
  modelName: string;
  /** The points available — the same across every run of this variant. */
  total: number;
  /** Max points earned across the model's runs. */
  highestScore: number;
  /** Mean points earned across the model's runs. */
  averageScore: number;
  /** Min points earned across the model's runs. */
  lowestScore: number;
  /** Best overall rating across the model's runs (null when unrated). */
  bestRating: Rating | null;
  /** Worst overall rating across the model's runs (null when unrated). */
  worstRating: Rating | null;
  /** Mean comparable cost across the model's runs, excluding runs with none. */
  averageCost: number | null;
  /** Mean token total across the model's runs, excluding runs with none. */
  averageTokens: number | null;
  /** The most recent run's start time, for the recency tie-break. */
  latestStartedAt: string;
}

// A metric column of the board. The rank (#) and model columns are fixed and
// rendered outside this set; these seven are toggleable via the picker, three of
// them visible by default. Each carries its own grid track width so the template
// can be built from the visible subset.
interface LeaderboardColumn {
  id: string;
  label: string;
  optional: boolean;
  defaultVisible: boolean;
  /** The grid track width this column occupies when shown. */
  width: string;
  /** Whether the cell is a right-aligned numeric figure (tabular). */
  numeric: boolean;
  render: (entry: Entry) => ReactNode;
}

// A points figure ("14 / 20" or, when averaged, "14.3 / 20") with its unit,
// mirroring the run pages' `pts` treatment.
function scoreCell(value: number, total: number): ReactNode {
  return (
    <span className={styles.num}>
      <span className={styles.scoreValue}>
        {formatPoints(value)} / {total}
      </span>{" "}
      <span className={styles.scoreUnit}>pts</span>
    </span>
  );
}

function ratingCell(rating: Rating | null): ReactNode {
  return (
    <span>
      {rating ? (
        <RatingBadge rating={rating} />
      ) : (
        <span className={styles.none}>—</span>
      )}
    </span>
  );
}

function costCell(cost: number | null): ReactNode {
  // formatUsd already renders an em dash for an unknown (null) cost.
  return <span className={styles.num}>{formatUsd(cost)}</span>;
}

function tokensCell(tokens: number | null): ReactNode {
  return (
    <span className={styles.num}>
      {tokens === null ? (
        <span className={styles.none}>—</span>
      ) : (
        formatCompact(tokens)
      )}
    </span>
  );
}

// The seven toggleable metric columns, in display order. Only Average Score,
// Best Rating, and Average Cost start visible; the other four are available from
// the column picker. Module-level so the array identity is stable across renders
// (the visibility hook and picker memoize on it).
const METRIC_COLUMNS: readonly LeaderboardColumn[] = [
  {
    id: "highestScore",
    label: "Highest Score",
    optional: true,
    defaultVisible: false,
    width: "9rem",
    numeric: true,
    render: (e) => scoreCell(e.highestScore, e.total),
  },
  {
    id: "averageScore",
    label: "Average Score",
    optional: true,
    defaultVisible: true,
    width: "9rem",
    numeric: true,
    render: (e) => scoreCell(e.averageScore, e.total),
  },
  {
    id: "lowestScore",
    label: "Lowest Score",
    optional: true,
    defaultVisible: false,
    width: "9rem",
    numeric: true,
    render: (e) => scoreCell(e.lowestScore, e.total),
  },
  {
    id: "bestRating",
    label: "Best Rating",
    optional: true,
    defaultVisible: true,
    width: "7rem",
    numeric: false,
    render: (e) => ratingCell(e.bestRating),
  },
  {
    id: "worstRating",
    label: "Worst Rating",
    optional: true,
    defaultVisible: false,
    width: "7rem",
    numeric: false,
    render: (e) => ratingCell(e.worstRating),
  },
  {
    id: "averageCost",
    label: "Average Cost",
    optional: true,
    defaultVisible: true,
    width: "7rem",
    numeric: true,
    render: (e) => costCell(e.averageCost),
  },
  {
    id: "averageTokens",
    label: "Average Tokens",
    optional: true,
    defaultVisible: false,
    width: "8rem",
    numeric: true,
    render: (e) => tokensCell(e.averageTokens),
  },
];

// The two fixed leading grid tracks: the rank gutter and the model name.
const FIXED_TRACKS = ["2.5rem", "1fr"];

// The Leaderboard tab (`/test-cases/:slug/leaderboard`): each model that has a
// scored run of the selected variant, ranked by average points. A model appears
// once, its runs folded into score extremes/mean, rating extremes, and cost/token
// means. Unlike the rest of the gallery, this IS a ranking — the score is what it
// ranks on. Which metric columns show is user-configurable (the ▦ picker or a
// header right-click); Average Score / Best Rating / Average Cost start visible.
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

  const { isVisible, toggle } = useColumnVisibility(
    "ttc:leaderboard:visible",
    METRIC_COLUMNS,
  );
  const menuRef = useRef<ColumnMenuHandle>(null);

  const visibleColumns = useMemo(
    () => METRIC_COLUMNS.filter((column) => isVisible(column.id)),
    [isVisible],
  );
  // The grid template driving both the header and every row, built from the
  // fixed rank/model tracks plus each visible metric column's width so the two
  // stay in lockstep as columns are shown or hidden.
  const gridTemplate = useMemo(
    () => [...FIXED_TRACKS, ...visibleColumns.map((c) => c.width)].join(" "),
    [visibleColumns],
  );

  // Aggregate every reviewed run of this case + variant per model, then rank the
  // models by average points.
  const entries = useMemo<Entry[]>(() => {
    // A model's scored runs, collected before they are folded into one Entry.
    interface Acc {
      modelName: string;
      total: number;
      earned: number[];
      ratings: Rating[];
      costs: number[];
      tokens: number[];
      latestStartedAt: string;
    }
    const accs = new Map<string, Acc>();
    for (const run of summaries) {
      if (
        run.subject.testCaseSlug !== testCase.slug ||
        run.subject.variant !== variant.slug
      ) {
        continue;
      }
      // Only a completed run can be ranked: a failed run produced no result and
      // is never reviewable, so it carries no score.
      if (run.state !== "completed") continue;
      // The run's earned/total points and overall rating, read from whichever
      // source this host populated: a published run arrives as a summary card the
      // backend/snapshot already enriched with its aggregate score + rating (the
      // console holds no per-review checklist for it once the summary/detail split
      // stopped loading whole records), while a local, not-yet-published console
      // run is scored from its preview writeup. Null drops the run off the board.
      const scored = resolveRunScore(run, variant, findReview, localWriteups);
      if (!scored) continue;
      const { earned, total, rating: overall } = scored;
      // Canonicalized (harness-aware) so an `openrouter/`-prefixed or `:free`-tagged
      // run and its base form fold into one model, not two rows.
      const modelId = canonicalModelId(
        run.subject.modelId,
        run.subject.harnessSlug,
      );
      // Null when the run's comparable cost / token total is unknown; such runs
      // are excluded from the respective mean rather than folded in as zero.
      const cost = run.metrics.cost.comparable;
      const tokens = totalTokens(run.metrics);

      let acc = accs.get(modelId);
      if (!acc) {
        acc = {
          modelName:
            findModel(run.subject.modelId, run.subject.harnessSlug)?.name ??
            modelId,
          total,
          earned: [],
          ratings: [],
          costs: [],
          tokens: [],
          latestStartedAt: run.startedAt,
        };
        accs.set(modelId, acc);
      }
      acc.total = total;
      acc.earned.push(earned);
      if (overall) acc.ratings.push(overall);
      if (cost !== null) acc.costs.push(cost);
      if (tokens !== null) acc.tokens.push(tokens);
      if (run.startedAt > acc.latestStartedAt) {
        acc.latestStartedAt = run.startedAt;
      }
    }

    const result: Entry[] = [];
    for (const [modelId, acc] of accs) {
      result.push({
        modelId,
        modelName: acc.modelName,
        total: acc.total,
        highestScore: Math.max(...acc.earned),
        averageScore: mean(acc.earned) ?? 0,
        lowestScore: Math.min(...acc.earned),
        bestRating: bestRating(acc.ratings),
        worstRating: worstRating(acc.ratings),
        averageCost: mean(acc.costs),
        averageTokens: mean(acc.tokens),
        latestStartedAt: acc.latestStartedAt,
      });
    }
    return result.sort(byAverageScoreThenRatingThenRecency);
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
        <div className={styles.wrap}>
          <div className={styles.menuAnchor}>
            <ColumnMenu
              ref={menuRef}
              columns={METRIC_COLUMNS}
              isVisible={isVisible}
              onToggle={toggle}
            />
          </div>
          <div
            className={styles.board}
            role="table"
            aria-label="Model leaderboard"
            style={{ "--ttc-lb-cols": gridTemplate } as CSSProperties}
            onContextMenu={(event) => {
              event.preventDefault();
              menuRef.current?.openAt(event.clientX, event.clientY);
            }}
          >
            <div
              className={`${styles.row} ${styles.head}`}
              role="row"
              aria-hidden="true"
            >
              <span className={styles.rank}>#</span>
              <span>MODEL</span>
              {visibleColumns.map((column) => (
                <span
                  key={column.id}
                  className={column.numeric ? styles.num : undefined}
                >
                  {column.label.toUpperCase()}
                </span>
              ))}
            </div>
            {entries.map((entry, index) => (
              <div className={styles.row} role="row" key={entry.modelId}>
                <span className={styles.rank}>{index + 1}</span>
                <span className={styles.model}>{entry.modelName}</span>
                {visibleColumns.map((column) => (
                  // Each metric cell carries its column label so the board can
                  // reflow into labelled value lines on a phone (see the mobile
                  // card rules in the stylesheet); on desktop the label is unused
                  // and the wrapper is a transparent grid cell.
                  <span
                    key={column.id}
                    className={styles.cell}
                    data-label={column.label}
                  >
                    {column.render(entry)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </section>
  );
}

// Resolve one run's board contribution — the points it earned, the points
// available, and its overall rating — from whichever source this host populated.
//
// A published run reaches the leaderboard as a summary card the backend (console)
// or snapshot builder (static site) already enriched with its aggregate `score`
// (mean earned weight over the shared total) and `rating`; since the summary/detail
// split, the console no longer loads a published run's full record eagerly, so its
// per-review checklist is not on hand to re-derive these — the enriched fields are.
// A console's own produced (local, not-yet-published) run carries no enriched score,
// so it falls back to the locally-previewed writeup that only such runs have and
// scores it against the variant's checklist. Returns null when the run has no
// resolvable review, so it drops off the board.
export function resolveRunScore(
  run: RunSummary,
  variant: VariantSummary,
  findReview: (
    runId: string,
    override?: Readonly<Record<string, string>>,
  ) => ParsedWriteup | undefined,
  localWriteups: Readonly<Record<string, string>>,
): { earned: number; total: number; rating: Rating | null } | null {
  if (run.score) {
    return {
      earned: run.score.earned,
      total: run.score.total,
      rating: run.rating,
    };
  }
  const review = findReview(run.id, localWriteups);
  if (!review || review.ratings.length === 0) return null;
  const { earned, total } = scoreChecklist(
    variant.reviewItems,
    review.checklist,
  );
  return {
    earned,
    total,
    rating: worstRating(review.ratings.map((r) => r.rating)),
  };
}

// The mean of `values`, or null when there are none — so a metric with no
// contributing run reads as "—" rather than a misleading 0.
function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// A points figure for display: an integer stays whole; a fractional mean shows a
// single decimal so "14 / 20" and "14.3 / 20" both read cleanly.
function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// The best (highest) rating among `ratings`, or null when empty — the mirror of
// `worstRating`, used for the Best Rating column.
function bestRating(ratings: readonly Rating[]): Rating | null {
  let best: Rating | null = null;
  let bestRank = RATINGS.length;
  for (const rating of ratings) {
    const rank = RATINGS.indexOf(rating);
    if (rank < bestRank) {
      bestRank = rank;
      best = rating;
    }
  }
  return best;
}

// Sort comparator: average points descending, then better (lower-ranked) best
// overall rating, then the more recent run. A null rating sorts worst.
function byAverageScoreThenRatingThenRecency(a: Entry, b: Entry): number {
  if (a.averageScore !== b.averageScore) return b.averageScore - a.averageScore;
  const ra = a.bestRating ? RATINGS.indexOf(a.bestRating) : RATINGS.length;
  const rb = b.bestRating ? RATINGS.indexOf(b.bestRating) : RATINGS.length;
  if (ra !== rb) return ra - rb;
  return b.latestStartedAt.localeCompare(a.latestStartedAt);
}
