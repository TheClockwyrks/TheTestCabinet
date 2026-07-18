import { useMemo, type ReactNode } from "react";
import type { TestType } from "@test-cabinet/run-record";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { GradeBadge, RatingBadge, canonicalModelId } from "@test-cabinet/ui";
import type { InProgressRun } from "../../client/types";
import {
  type GradeStatus,
  isGrade,
  overallGradeOf,
  type Rating,
  RATINGS,
  worstRating,
} from "../data/ratings";
import { describeRunState } from "../data/runState";
import { useFindReview } from "../data/writeups";
import { useTestCaseName } from "../data/useTestCaseName";
import {
  formatPoints,
  formatRunTime,
  formatSlug,
  formatTimestamp,
  formatTokenTotal,
  formatUsd,
  totalTokens,
} from "../format";
import { RunSelectBox, type RunSelectionContext } from "./RunSelect";
import { sortRows, type SortState } from "./useTableSort";
import { UnpublishedTag } from "./UnpublishedTag";
import styles from "./RunLog.module.scss";

/**
 * Which columns a run log carries.
 *
 * - `"global"` offers every column for cross-case listings (the home page).
 * - `"variant"` drops the test and variant columns for pages already scoped to
 *   a single test case and variant, where they would be constant.
 * - `"model"` drops the model column for the model detail page, where every row
 *   is the same model; it keeps the test and variant columns.
 */
export type RunScope = "global" | "variant" | "model";

// Narrow a summary card's overall-grade field (a `VerdictStatus`, which also
// covers the binary pass/fail) to one of the five graded tiers, or null. A non-jam
// run carries none.
function asGrade(status: string | null | undefined): GradeStatus | null {
  return status && isGrade(status) ? status : null;
}

/**
 * A finished run resolved for the table: the summary card plus the two values a
 * cell (and a sort) needs that don't live on the card — the case's display name
 * and the run's reviewer rating. Resolved once per row (see {@link
 * useEnrichedRuns}) so sorting and rendering share the work instead of each cell
 * re-deriving it.
 */
export interface EnrichedRun {
  summary: RunSummary;
  local: boolean;
  displayName: string;
  rating: Rating | null;
  /** A game-jam run's whole-game overall grade, shown as its badge in place of a
   * domain rating (a jam has none). Null for every non-jam run. */
  grade: GradeStatus | null;
}

/** Cross-cell context a column's renderer needs beyond its own row. */
export interface RunRenderContext {
  /** The ids of the columns currently shown, so a cell can adapt (e.g. the test
   * column being absent moves the unpublished tag onto the harness cell). */
  visible: ReadonlySet<string>;
  /** Resolver for an in-progress run's case name (finished rows are pre-resolved). */
  testCaseName: (slug: string) => string;
  /** Resolver for an in-progress run's test type (finished rows read it off the
   * record). Null when the catalog doesn't know the slug. */
  testCaseType: (slug: string) => TestType | null;
  /** When present, the log is selectable: the caret column renders a checkbox
   * bound to this controller instead of the hover caret. Absent on non-selectable
   * logs, where the gutter keeps its plain caret / spinner. */
  selection?: RunSelectionContext;
}

/**
 * One column of the run log: its header, its grid track, how it renders a
 * finished and an in-progress row, and — when sortable — the key a sort orders
 * by. Columns without a `sortKey` have no sort affordance; `optional` columns can
 * be shown or hidden from the picker (every data column is optional) and, when
 * `defaultVisible` is false, start hidden.
 */
export interface RunColumn {
  id: string;
  label: string;
  default: string;
  min: number;
  /** A non-resizable gutter (no drag handle on its right edge). */
  resizable?: boolean;
  /** Right-aligned like a printed figure; also aligns the header label. */
  numeric?: boolean;
  optional?: boolean;
  defaultVisible?: boolean;
  /** The value this column sorts by, ascending. Null values always sort last. */
  sortKey?: (row: EnrichedRun) => string | number | null;
  render: (row: EnrichedRun, ctx: RunRenderContext) => ReactNode;
  renderActive: (run: InProgressRun, ctx: RunRenderContext) => ReactNode;
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  "end-to-end": "End-to-end",
  "full-stack": "Full-stack",
  "asset-generation": "Asset gen",
  adversarial: "Adversarial",
  performance: "Performance",
};

function categoryLabel(testType: string): string {
  return CATEGORY_LABELS[testType] ?? formatSlug(testType);
}

// The status label for an in-progress run's live phase. "queued"/"starting" carry
// an ellipsis (work is pending and will proceed on its own); "pending" is a
// deliberate hold (the harness is at its parallelism cap), shown without one so it
// reads as a settled state rather than imminent progress.
const ACTIVE_STATE_LABEL: Readonly<Record<InProgressRun["state"], string>> = {
  queued: "queued…",
  pending: "pending",
  starting: "starting…",
  running: "running…",
  failed: "failed",
};

// A muted em-dash placeholder for a cell an in-progress run can't fill yet (it
// has no metrics or timestamps until it finishes). `numeric` right-aligns it to
// match the finished figure it stands in for.
function activeDash(label: string, numeric: boolean): ReactNode {
  return (
    <span
      className={`${numeric ? styles.num : styles.when} ${styles.noRating}`}
      data-label={label}
    >
      &mdash;
    </span>
  );
}

// The full column set, left→right. The caret gutter leads; the test name anchors
// each row; the metric group and rating trail. Every data column is `optional`
// so the picker can show or hide any of them; only the caret gutter is fixed.
// Category, timestamp, and duration additionally start hidden (`defaultVisible:
// false`), so the resting table matches its prior layout until a user opts them
// in via the column picker.
export const RUN_COLUMNS: readonly RunColumn[] = [
  {
    id: "caret",
    label: "",
    default: "1.2rem",
    min: 20,
    resizable: false,
    // Selectable logs swap the hover caret for a checkbox; an in-progress row's
    // box overlays the live spinner (passed through `active`) so the gutter still
    // signals the run is running until the row is hovered or picked.
    render: (row, ctx) =>
      ctx.selection ? (
        <RunSelectBox id={row.summary.id} selection={ctx.selection} />
      ) : (
        <span className={styles.rowCaret}>&rsaquo;</span>
      ),
    renderActive: (run, ctx) =>
      ctx.selection ? (
        <RunSelectBox id={run.runId} active selection={ctx.selection} />
      ) : (
        <span className={styles.spinner} aria-hidden="true" />
      ),
  },
  {
    id: "test",
    label: "TEST",
    default: "1fr",
    min: 96,
    optional: true,
    sortKey: (row) => row.displayName.toLowerCase(),
    render: (row) => (
      <span className={styles.test}>
        <span className={styles.testName}>{row.displayName}</span>
        {row.local && <UnpublishedTag className={styles.tag} />}
      </span>
    ),
    renderActive: (run, ctx) => (
      <span className={styles.test}>
        <span className={styles.testName}>
          {ctx.testCaseName(run.testCaseSlug)}
        </span>
      </span>
    ),
  },
  {
    id: "version",
    label: "VERSION",
    default: "5rem",
    min: 56,
    optional: true,
    defaultVisible: false,
    sortKey: (row) => row.summary.subject.testCaseVersion.toLowerCase(),
    render: (row) => (
      <span className={styles.version} data-label="Version">
        {row.summary.subject.testCaseVersion}
      </span>
    ),
    // The launched version is fixed at enqueue, so an in-progress run already
    // knows it — no dash needed.
    renderActive: (run) => (
      <span className={styles.version} data-label="Version">
        {run.testCaseVersion}
      </span>
    ),
  },
  {
    id: "category",
    label: "CATEGORY",
    default: "7rem",
    min: 72,
    optional: true,
    defaultVisible: false,
    sortKey: (row) => categoryLabel(row.summary.subject.testType).toLowerCase(),
    render: (row) => (
      <span className={styles.category} data-label="Category">
        {categoryLabel(row.summary.subject.testType)}
      </span>
    ),
    // The category is the case's type, which the catalog carries independently of
    // the run — resolve it by slug rather than dashing. Falls back to a dash only
    // when the catalog doesn't know the slug.
    renderActive: (run, ctx) => {
      const testType = ctx.testCaseType(run.testCaseSlug);
      return testType == null ? (
        activeDash("Category", false)
      ) : (
        <span className={styles.category} data-label="Category">
          {categoryLabel(testType)}
        </span>
      );
    },
  },
  {
    id: "harness",
    label: "HARNESS",
    default: "7rem",
    min: 64,
    optional: true,
    sortKey: (row) => row.summary.subject.harnessSlug.toLowerCase(),
    render: (row, ctx) => (
      <span className={styles.harness} data-label="Harness">
        {row.summary.subject.harnessSlug}
        {/* Without a TEST column to host it, flag unpublished runs here. */}
        {!ctx.visible.has("test") && row.local && (
          <UnpublishedTag className={styles.tag} />
        )}
      </span>
    ),
    renderActive: (run) => (
      <span className={styles.harness} data-label="Harness">
        {run.harnessSlug}
      </span>
    ),
  },
  {
    id: "variant",
    label: "VARIANT",
    default: "6rem",
    min: 56,
    optional: true,
    sortKey: (row) => row.summary.subject.variant.toLowerCase(),
    render: (row) => (
      <span className={styles.variant} data-label="Variant">
        {row.summary.subject.variant}
      </span>
    ),
    renderActive: (run) => (
      <span className={styles.variant} data-label="Variant">
        {run.variant}
      </span>
    ),
  },
  {
    id: "model",
    label: "MODEL",
    default: "1.6fr",
    min: 96,
    optional: true,
    sortKey: (row) =>
      canonicalModelId(row.summary.subject.modelId).toLowerCase(),
    render: (row) => (
      <span className={styles.model} data-label="Model">
        {canonicalModelId(row.summary.subject.modelId)}
      </span>
    ),
    renderActive: (run) => (
      <span className={styles.model} data-label="Model">
        {canonicalModelId(run.modelId)}
      </span>
    ),
  },
  {
    id: "timestamp",
    label: "STARTED",
    default: "10.5rem",
    min: 120,
    optional: true,
    defaultVisible: false,
    sortKey: (row) => row.summary.startedAt,
    render: (row) => (
      <span className={styles.when} data-label="Started">
        {formatTimestamp(row.summary.startedAt)}
      </span>
    ),
    renderActive: () => activeDash("Started", false),
  },
  {
    id: "duration",
    label: "DURATION",
    default: "5.5rem",
    min: 64,
    optional: true,
    defaultVisible: false,
    numeric: true,
    sortKey: (row) => row.summary.metrics.runTimeSeconds,
    render: (row) => (
      <span className={styles.num} data-label="Duration">
        {formatRunTime(row.summary.metrics.runTimeSeconds)}
      </span>
    ),
    renderActive: () => activeDash("Duration", true),
  },
  {
    id: "tokens",
    label: "TOKENS",
    default: "5rem",
    min: 56,
    numeric: true,
    optional: true,
    sortKey: (row) => totalTokens(row.summary.metrics),
    render: (row) => (
      <span className={styles.num} data-label="Tokens">
        {formatTokenTotal(row.summary.metrics)}
      </span>
    ),
    renderActive: () => activeDash("Tokens", true),
  },
  {
    id: "cost",
    label: "COST",
    default: "5rem",
    min: 56,
    numeric: true,
    optional: true,
    sortKey: (row) => row.summary.metrics.cost.comparable,
    render: (row) => (
      <span className={styles.num} data-label="Cost">
        {formatUsd(row.summary.metrics.cost.comparable)}
      </span>
    ),
    renderActive: () => activeDash("Cost", true),
  },
  {
    id: "points",
    label: "POINTS",
    default: "5.5rem",
    min: 64,
    numeric: true,
    optional: true,
    // Off by default: the points figure is a reviewer aggregate most run lists
    // don't lead with, and (unlike the metric columns) the server can't sort by
    // it — the checklist weights it derives from aren't a run column — so it
    // carries no `sortKey` and its header offers no sort affordance.
    defaultVisible: false,
    render: (row) => (
      <span
        className={`${styles.num} ${row.summary.score ? "" : styles.noRating}`}
        data-label="Points"
      >
        {formatPoints(row.summary.score)}
      </span>
    ),
    renderActive: () => activeDash("Points", true),
  },
  {
    id: "rating",
    label: "RATING",
    default: "6rem",
    min: 56,
    optional: true,
    // Ordered best→worst by RATINGS rank, so ascending lists the best runs first.
    sortKey: (row) => (row.rating == null ? null : RATINGS.indexOf(row.rating)),
    render: (row) => {
      const presentation = describeRunState(row.summary.state);
      if (presentation.isFailure) {
        return (
          <span className={styles.rating} data-label="Rating">
            <span
              className={styles.activeStatus}
              data-state={row.summary.state}
            >
              {presentation.chip}
            </span>
          </span>
        );
      }
      return (
        <span className={styles.rating} data-label="Rating">
          {/* A game jam carries a whole-game overall grade in place of a domain
              rating, so its badge is the grade; every other run shows its rating. */}
          {row.grade ? (
            <GradeBadge status={row.grade} />
          ) : row.rating ? (
            <RatingBadge rating={row.rating} />
          ) : (
            <span className={styles.noRating}>&mdash;</span>
          )}
        </span>
      );
    },
    renderActive: (run) => (
      <span className={styles.rating} data-label="Status">
        <span className={styles.activeStatus} data-state={run.state}>
          {ACTIVE_STATE_LABEL[run.state]}
        </span>
      </span>
    ),
  },
];

const COLUMN_BY_ID = new Map(RUN_COLUMNS.map((column) => [column.id, column]));

// Columns each scope leaves out entirely (as opposed to merely hiding by
// default): they'd be constant for every row on that page.
const SCOPE_EXCLUDES: Record<RunScope, ReadonlySet<string>> = {
  global: new Set(),
  variant: new Set(["test", "variant"]),
  model: new Set(["model"]),
};

/** The columns available in a given scope, in render order. */
export function columnsForScope(scope: RunScope): RunColumn[] {
  const excluded = SCOPE_EXCLUDES[scope];
  return RUN_COLUMNS.filter((column) => !excluded.has(column.id));
}

/** Whether a column offers a sort. */
export function isSortable(column: RunColumn): boolean {
  return typeof column.sortKey === "function";
}

/**
 * Order runs by the active sort, or return them in their given (default: recency)
 * order when there is none. Unknown values (a missing rating, an unreported
 * token/cost figure) always sort last, in either direction; the sort is stable.
 */
export function sortRuns(
  rows: readonly EnrichedRun[],
  sort: SortState | null,
): EnrichedRun[] {
  return sortRows(rows, sort, (id) => COLUMN_BY_ID.get(id)?.sortKey);
}

/**
 * Resolve each run's display name and rating once, up front — the two values a
 * cell or a sort needs that aren't already resolved on the card. A hook because
 * it reads the catalog (for names) and the active review source (for ratings);
 * call it at the top of a page, then sort/page/render the result freely.
 *
 * A local, unpublished writeup still wins the rating (an in-progress edit must
 * show before it is published); absent one, the summary's own aggregate rating
 * (`summary.rating`) stands in.
 */
export function useEnrichedRuns(
  runs: readonly RunSummary[],
  localIds: ReadonlySet<string>,
  localWriteups: Readonly<Record<string, string>>,
): EnrichedRun[] {
  const testCaseName = useTestCaseName();
  const findReview = useFindReview();
  return useMemo(
    () =>
      runs.map((summary) => {
        const review = findReview(summary.id, localWriteups);
        return {
          summary,
          local: localIds.has(summary.id),
          displayName: testCaseName(summary.subject.testCaseSlug),
          rating:
            worstRating(review?.ratings.map((r) => r.rating) ?? []) ??
            summary.rating,
          // A jam's overall grade: a local, in-progress review wins (it must show
          // before it is published, mirroring the rating); absent one, the
          // summary card's aggregate `score.overallGrade` stands in.
          grade:
            (review && overallGradeOf(review.checklist)) ??
            asGrade(summary.score?.overallGrade),
        };
      }),
    [runs, localIds, localWriteups, testCaseName, findReview],
  );
}
