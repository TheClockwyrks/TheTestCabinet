import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { AestheticBadge, GradeBadge, RatingBadge } from "@clockwyrks/ui";
import { Panel } from "@clockwyrks/ui";
import {
  AnchoredScopeControls,
  useAnchoredScope,
} from "../../../components/anchoredScope";
import { engineName } from "../../../data/engines";
import { useCaseRunSummaries } from "../../../data/useRuns";
import { useFindReview } from "../../../data/writeups";
import { useFindModel } from "../../../data/useModels";
import { perModelBestFuel } from "../../../data/fuelRanking";
import {
  bestAestheticRating,
  bestGrade,
  bestRating,
  foldLeaderboardEntries,
  mean,
} from "../../../data/leaderboardFold";
import {
  type AestheticRating,
  formatPoints,
  type GradeStatus,
  RATINGS,
  worstAestheticRating,
  worstGrade,
  worstRating,
  type Rating,
} from "../../../data/ratings";
import {
  TestCaseDetailLayout,
  type DetailTabContext,
} from "../../../layouts/testcases/TestCaseDetailLayout";
import {
  ColumnMenu,
  type ColumnMenuHandle,
} from "../../../components/ColumnMenu";
import { useColumnVisibility } from "../../../components/useColumnVisibility";
import { LoadingState } from "../../../components/LoadingState";
import { formatCompact, formatUsd } from "../../../format";
import styles from "./TestCaseLeaderboardPage.module.scss";

// The run-score resolution moved into the shared leaderboard fold; re-exported
// so its established import site here (the Metrics page, the tests) still holds.
export { resolveRunScore } from "../../../data/leaderboardFold";

// One `(harness, model)` pair's aggregate result on this case + variant, folded
// across ALL of that pair's scored runs (not just its single best). The
// score/rating extremes and the cost/token means are what the configurable
// columns render. The board splits by harness as well as model — the same model
// under two harnesses is two rows, never one merged rank (see
// docs/comparisons/metrics-split). A board widened across engines splits by the
// run's engine too: runs under different engines measure different work, so
// they are never folded into one row.
interface Entry {
  /** The composite `(harness, model[, engine])` key; also the React row key. */
  rowKey: string;
  modelId: string;
  modelName: string;
  /** The harness that produced this pair's runs, shown beside the model name. */
  harnessSlug: string;
  /** The engine's display name, shown beside the harness — only on a board
   * widened across engines; null in the (common) anchored-engine view, where
   * every row shares the page's anchored engine. */
  engineLabel: string | null;
  /** The points available — the same across every run of this variant. */
  total: number;
  /** Max points earned across the model's runs. */
  highestScore: number;
  /** Mean points earned across the model's runs. */
  averageScore: number;
  /** Min points earned across the model's runs. */
  lowestScore: number;
  /** Best overall functional rating across the model's runs (null when unrated). */
  bestRating: Rating | null;
  /** Worst overall functional rating across the model's runs (null when unrated). */
  worstRating: Rating | null;
  /** Best overall aesthetic rating across the model's runs, shown beside the
   * functional badge; null when no run of the pair carries one (every legacy
   * run, and a validator-rated run nobody has reviewed). */
  bestAesthetic: AestheticRating | null;
  /** Worst overall aesthetic rating across the model's runs; null as above. */
  worstAesthetic: AestheticRating | null;
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
// other case shows its functional rating. An entry never carries both. The
// aesthetic badge sits beside the functional one wherever a run's rating shows,
// so a Legendary / Amazing pair is visible on the board; it is omitted when no
// run of the pair carries an aesthetic rating (a legacy case never does).
function ratingCell(
  rating: Rating | null,
  grade: GradeStatus | null,
  aesthetic: AestheticRating | null,
): ReactNode {
  return (
    <span className={styles.badges}>
      {grade ? (
        <GradeBadge status={grade} />
      ) : rating ? (
        <RatingBadge rating={rating} />
      ) : (
        <span className={styles.none}>—</span>
      )}
      {aesthetic && <AestheticBadge rating={aesthetic} />}
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
    render: (e) => ratingCell(e.bestRating, e.bestGrade, e.bestAesthetic),
  },
  {
    id: "worstRating",
    label: "Worst Rating",
    optional: true,
    defaultVisible: false,
    width: "7rem",
    numeric: false,
    render: (e) => ratingCell(e.worstRating, e.worstGrade, e.worstAesthetic),
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
      {(ctx) => <LeaderboardContent ctx={ctx} />}
    </TestCaseDetailLayout>
  );
}

// The leaderboard body, given the page's anchored coordinate. Exported so the
// game-jam detail's Leaderboard tab renders the identical board under its own
// layout — the ranking (average points) and the badge cell (a grade for a jam, a
// rating otherwise) are already case-agnostic.
export function LeaderboardContent({ ctx }: { ctx: DetailTabContext }) {
  // A performance case carries no reviewer score to rank on — it is graded by the
  // harness (correctness, then fuel) — so it ranks by fuel instead, on its own
  // board. Branch before any hook so the review board's hooks never run for it.
  if (ctx.testCase.testType === "performance") {
    return <PerformanceLeaderboard ctx={ctx} />;
  }
  return <ReviewLeaderboard ctx={ctx} />;
}

// The review-score leaderboard: the original board, ranking each model by the
// average points its runs earned across the variant's checklist. Used for every
// human-reviewed case type (a performance case uses the fuel board instead).
function ReviewLeaderboard({ ctx }: { ctx: DetailTabContext }) {
  const { testCase, version, engine, variant } = ctx;
  const { summaries, localWriteups, loading } = useCaseRunSummaries(
    testCase.slug,
  );
  const findReview = useFindReview();
  const findModel = useFindModel();

  // Which runs the board ranks over, relative to the page's anchored coordinate
  // — the same control (and the same query params) the Runs and Metrics tabs
  // carry, so the three tabs describe one cohort. Without a version scope a
  // revised case would rank models against each other that were never set the
  // same task; the anchored `major.minor` default keeps the board to the spec
  // in play, and widening it is the visitor's call.
  // The engine widener is offered only when the anchored version supports more
  // than one engine — with one engine there is nothing to widen into, and the
  // hook then reads the anchored scope regardless of a stale `?engines=all`.
  const multiEngine = (testCase.enginesByVersion[version] ?? []).length > 1;
  const anchoredScope = useAnchoredScope({
    version,
    versions: testCase.versions,
    engineWidenable: multiEngine,
  });
  const { versionScope, engineScope } = anchoredScope;
  const engineWidened = engineScope === "all";

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
  // models by average points. The row identity and the run-level exclusions
  // (non-completed, gg, score-less) live in the shared fold; this page scopes
  // the input and renders points against the variant's shared total.
  const entries = useMemo<Entry[]>(() => {
    const scoped = summaries.filter((run) => {
      if (
        run.subject.testCaseSlug !== testCase.slug ||
        run.subject.variant !== variant.slug
      ) {
        return false;
      }
      // Only runs of the versions the visitor scoped to. Membership comes from
      // the scope's catalog-version list — the same list the Runs tab's server
      // query sends — so the board and the run list count one cohort.
      if (!anchoredScope.inVersionScope(run.subject.testCaseVersion)) {
        return false;
      }
      // Runs under a different engine measure different work: the anchored
      // engine scope keeps them off the board entirely, and the widened scope
      // splits them into per-engine rows (the fold keys by engine) rather than
      // folding them together. A summary from before engine selection existed
      // reads as the engineless "none".
      return engineWidened || (run.subject.engineSlug ?? "none") === engine;
    });
    const folded = foldLeaderboardEntries(scoped, {
      variant,
      findReview,
      localWriteups,
      keyEngine: engineWidened,
      resolveModelName: (modelId, harnessSlug) =>
        findModel(modelId, harnessSlug)?.name ?? null,
    });
    const result = folded.map(
      (entry): Entry => ({
        rowKey: entry.rowKey,
        modelId: entry.modelId,
        modelName: entry.modelName,
        harnessSlug: entry.harnessSlug,
        engineLabel:
          entry.engineSlug !== null ? engineName(entry.engineSlug) : null,
        total: entry.total,
        highestScore: Math.max(...entry.earned),
        averageScore: mean(entry.earned) ?? 0,
        lowestScore: Math.min(...entry.earned),
        bestRating: bestRating(entry.ratings),
        worstRating: worstRating(entry.ratings),
        bestAesthetic: bestAestheticRating(entry.aesthetics),
        worstAesthetic: worstAestheticRating(entry.aesthetics),
        bestGrade: bestGrade(entry.grades),
        worstGrade: worstGrade(entry.grades),
        averageCost: mean(entry.costs),
        averageTokens: mean(entry.tokens),
        latestStartedAt: entry.latestStartedAt,
      }),
    );
    return result.sort(byAverageScoreThenRatingThenRecency);
  }, [
    summaries,
    localWriteups,
    findReview,
    findModel,
    testCase.slug,
    variant.slug,
    variant.reviewItems,
    versionScope,
    version,
    testCase.versions,
    engineWidened,
    engine,
  ]);

  // The case's runs drain over several requests, so an unqualified empty board
  // would claim "no scored runs yet" before any had arrived. Wait for the drain
  // to settle before reading anything into an empty entry list.
  if (loading) {
    return (
      <section className={styles.section}>
        <LoadingState size="section" label="Loading leaderboard…" />
      </section>
    );
  }

  // The scope controls the board renders: the version segments, plus the engine
  // widener when the anchored version has more than one engine to widen into.
  const controls = (
    <AnchoredScopeControls
      state={anchoredScope}
      engine={multiEngine ? { name: engineName(engine) } : undefined}
    />
  );
  // Whether some narrowing is in effect that widening could undo — what decides
  // if the empty state should suggest widening the scope.
  const narrowed =
    (anchoredScope.showVersions && versionScope !== "all") ||
    (multiEngine && !engineWidened);

  // The controls stay mounted alongside the empty state: a scope that filtered
  // every run away must still be adjustable, or the visitor is stuck on an empty
  // board with no way back.
  if (entries.length === 0) {
    return (
      <section className={styles.section}>
        {controls}
        <Panel>
          <p className={styles.empty}>
            {narrowed ? (
              <>
                No scored runs of {variant.name} in the selected scope. Widen
                the scope, or review a run of this one.
              </>
            ) : (
              <>
                No scored runs of {variant.name} yet. The leaderboard ranks
                models once their runs have been reviewed.
              </>
            )}
          </p>
        </Panel>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      {controls}
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
              <div className={styles.row} role="row" key={entry.rowKey}>
                <span className={styles.rank}>{index + 1}</span>
                <span className={styles.model}>
                  {entry.modelName}{" "}
                  <span className={styles.harness}>
                    · {entry.harnessSlug}
                    {entry.engineLabel ? ` · ${entry.engineLabel}` : ""}
                  </span>
                </span>
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
// Fuel is only comparable within one scored scenario set, so the board ignores
// the widening scope controls the review board carries and pins to the EXACT
// anchored version (picked in the page header) and variant — never a mix, which
// would rank engines that were never set the same scenarios against each other.
function PerformanceLeaderboard({ ctx }: { ctx: DetailTabContext }) {
  const { testCase, version, variant } = ctx;
  const { summaries, loading } = useCaseRunSummaries(testCase.slug);
  const findModel = useFindModel();

  const entries = useMemo(
    () =>
      perModelBestFuel(
        summaries,
        {
          slug: testCase.slug,
          version,
          variant: variant.slug,
        },
        (id, harness) => findModel(id, harness)?.name ?? id,
      ),
    [summaries, findModel, testCase.slug, version, variant.slug],
  );

  // As on the review board, an empty entry list means nothing until the case's
  // runs have finished draining.
  if (loading) {
    return (
      <section className={styles.section}>
        <LoadingState size="section" label="Loading leaderboard…" />
      </section>
    );
  }

  // A version with no correct runs is not a dead end: the version is anchored
  // in the page header, so the empty state names it (when there was a version
  // to choose) and the header is where another one is picked.
  if (entries.length === 0) {
    const cohort =
      testCase.versions.length > 1
        ? `${variant.name} on ${version}`
        : variant.name;
    return (
      <section className={styles.section}>
        <Panel>
          <p className={styles.empty}>
            No correct runs of {cohort} yet. The leaderboard ranks models by the
            fuel of their best correct engine, and only a correct engine earns a
            fuel score.
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
          Ranked by total fuel, where lower is better. Each model counts once,
          at its most efficient correct run of {version}.
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
                  <span className={styles.num}>
                    {formatCompact(entry.bestFuel)}
                  </span>
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

// Sort comparator: average points descending, then better (lower-ranked) best
// overall rating, then the more recent run. A null rating sorts worst.
function byAverageScoreThenRatingThenRecency(a: Entry, b: Entry): number {
  if (a.averageScore !== b.averageScore) return b.averageScore - a.averageScore;
  const ra = a.bestRating ? RATINGS.indexOf(a.bestRating) : RATINGS.length;
  const rb = b.bestRating ? RATINGS.indexOf(b.bestRating) : RATINGS.length;
  if (ra !== rb) return ra - rb;
  return b.latestStartedAt.localeCompare(a.latestStartedAt);
}
