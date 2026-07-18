import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { GradeBadge, RatingBadge } from "@test-cabinet/ui";
import { Panel, canonicalModelId } from "@test-cabinet/ui";
import { useCaseRunSummaries } from "../../../data/useRuns";
import { useFindReview } from "../../../data/writeups";
import { useFindModel } from "../../../data/useModels";
import { perModelBestFuel } from "../../../data/fuelRanking";
import {
  GRADE_LEVELS,
  type GradeStatus,
  isGrade,
  overallGradeOf,
  RATINGS,
  scoreChecklist,
  worstGrade,
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
  /** Best whole-game overall grade across the model's runs, for a game jam
   * (which carries a grade in place of a domain rating); null for a non-jam. */
  bestGrade: GradeStatus | null;
  /** Worst whole-game overall grade across the model's runs; null for a non-jam. */
  worstGrade: GradeStatus | null;
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

// The board's rating cell adapts to the case: a game jam carries a whole-game
// overall grade in place of a domain rating, so its badge is the grade; every
// other case shows its rating. An entry never carries both.
function ratingCell(rating: Rating | null, grade: GradeStatus | null): ReactNode {
  return (
    <span>
      {grade ? (
        <GradeBadge status={grade} />
      ) : rating ? (
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
    render: (e) => ratingCell(e.bestRating, e.bestGrade),
  },
  {
    id: "worstRating",
    label: "Worst Rating",
    optional: true,
    defaultVisible: false,
    width: "7rem",
    numeric: false,
    render: (e) => ratingCell(e.worstRating, e.worstGrade),
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

// The leaderboard body, given the resolved case and variant. Exported so the
// game-jam detail's Leaderboard tab renders the identical board under its own
// layout — the ranking (average points) and the badge cell (a grade for a jam, a
// rating otherwise) are already case-agnostic.
export function LeaderboardContent({
  testCase,
  variant,
}: {
  testCase: TestCaseSummary;
  variant: VariantSummary;
}) {
  // A performance case carries no reviewer score to rank on — it is graded by the
  // harness (correctness, then fuel) — so it ranks by fuel instead, on its own
  // board. Branch before any hook so the review board's hooks never run for it.
  if (testCase.testType === "performance") {
    return <PerformanceLeaderboard testCase={testCase} variant={variant} />;
  }
  return <ReviewLeaderboard testCase={testCase} variant={variant} />;
}

// The review-score leaderboard: the original board, ranking each model by the
// average points its runs earned across the variant's checklist. Used for every
// human-reviewed case type (a performance case uses the fuel board instead).
function ReviewLeaderboard({
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
      grades: GradeStatus[];
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
      const { earned, total, rating: overall, grade: overallGrade } = scored;
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
          grades: [],
          costs: [],
          tokens: [],
          latestStartedAt: run.startedAt,
        };
        accs.set(modelId, acc);
      }
      acc.total = total;
      acc.earned.push(earned);
      if (overall) acc.ratings.push(overall);
      if (overallGrade) acc.grades.push(overallGrade);
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
        bestGrade: bestGrade(acc.grades),
        worstGrade: worstGrade(acc.grades),
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

// The fuel leaderboard for a PERFORMANCE case: each model that has a correct run
// of the selected variant, ranked by the fuel of its BEST correct engine (lower is
// better). A model appears once — folding its runs to their best keeps a re-run
// model from flooding the board, since deterministic fuel makes reruns identical.
// Fuel is only comparable within one scored scenario set, so the board is scoped to
// the case's latest version and the selected variant.
function PerformanceLeaderboard({
  testCase,
  variant,
}: {
  testCase: TestCaseSummary;
  variant: VariantSummary;
}) {
  const { summaries } = useCaseRunSummaries(testCase.slug);
  const findModel = useFindModel();

  const entries = useMemo(
    () =>
      perModelBestFuel(
        summaries,
        {
          slug: testCase.slug,
          version: testCase.latestVersion,
          variant: variant.slug,
        },
        (id, harness) => findModel(id, harness)?.name ?? id,
      ),
    [summaries, findModel, testCase.slug, testCase.latestVersion, variant.slug],
  );

  if (entries.length === 0) {
    return (
      <section className={styles.section}>
        <Panel>
          <p className={styles.empty}>
            No correct runs of {variant.name} yet — the leaderboard ranks models
            by the fuel of their best correct engine, and only a correct engine
            earns a fuel score.
          </p>
        </Panel>
      </section>
    );
  }

  // Fixed rank/model tracks plus the two fuel-board columns (best fuel, run count).
  const gridTemplate = [...FIXED_TRACKS, "10rem", "5rem"].join(" ");

  return (
    <section className={styles.section}>
      <Panel>
        <p>
          Ranked by total fuel — lower is better. Each model counts once, at its
          most efficient correct run of {testCase.latestVersion}.
        </p>
        <div className={styles.wrap}>
          <div
            className={styles.board}
            role="table"
            aria-label="Model fuel leaderboard"
            style={{ "--ttc-lb-cols": gridTemplate } as CSSProperties}
          >
            <div
              className={`${styles.row} ${styles.head}`}
              role="row"
              aria-hidden="true"
            >
              <span className={styles.rank}>#</span>
              <span>MODEL</span>
              <span className={styles.num}>BEST FUEL</span>
              <span className={styles.num}>RUNS</span>
            </div>
            {entries.map((entry, index) => (
              <div className={styles.row} role="row" key={entry.modelId}>
                <span className={styles.rank}>{index + 1}</span>
                <span className={styles.model}>{entry.modelName}</span>
                <span className={styles.cell} data-label="Best fuel">
                  <span className={styles.num}>{formatCompact(entry.bestFuel)}</span>
                </span>
                <span className={styles.cell} data-label="Runs">
                  <span className={styles.num}>{entry.runCount}</span>
                </span>
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
): {
  earned: number;
  total: number;
  rating: Rating | null;
  grade: GradeStatus | null;
} | null {
  if (run.score) {
    return {
      earned: run.score.earned,
      total: run.score.total,
      rating: run.rating,
      // A jam's summary carries its whole-game overall grade here; a non-jam's is
      // absent/null.
      grade: asGrade(run.score.overallGrade),
    };
  }
  const review = findReview(run.id, localWriteups);
  if (!review) return null;
  // A game jam grades its categories (and a whole-game overall mark) rather than
  // rating scoring domains, so it carries no per-domain ratings — its review is
  // scored off the checklist and badged by the overall grade. Detect it from the
  // variant's items so a local, not-yet-published jam run still ranks.
  const graded = variant.reviewItems.some((item) => item.graded);
  if (graded) {
    const grade = overallGradeOf(review.checklist);
    // A jam review with neither an overall grade nor any category verdict has
    // nothing to contribute — drop it, mirroring the unrated case below.
    if (!grade && review.checklist.length === 0) return null;
    const { earned, total } = scoreChecklist(
      variant.reviewItems,
      review.checklist,
    );
    return { earned, total, rating: null, grade };
  }
  if (review.ratings.length === 0) return null;
  const { earned, total } = scoreChecklist(
    variant.reviewItems,
    review.checklist,
  );
  return {
    earned,
    total,
    rating: worstRating(review.ratings.map((r) => r.rating)),
    grade: null,
  };
}

// Narrow a `VerdictStatus` (which also covers pass/fail) to one of the five
// graded tiers, or null.
function asGrade(status: string | null | undefined): GradeStatus | null {
  return status && isGrade(status) ? status : null;
}

// The best (highest-point) graded tier among `grades`, or null when empty — the
// mirror of `worstGrade`, used for the Best Rating column on a game jam.
function bestGrade(grades: readonly GradeStatus[]): GradeStatus | null {
  let best: GradeStatus | null = null;
  let bestRank = -1;
  for (const grade of grades) {
    const rank = GRADE_LEVELS.indexOf(grade);
    if (rank > bestRank) {
      bestRank = rank;
      best = grade;
    }
  }
  return best;
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
