import { Fragment, useMemo, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { GradeBadge, RatingBadge, canonicalModelId } from "@test-cabinet/ui";
import type { MyReview, StoredReview } from "../../client/types";
import { overallGradeOf, worstRating } from "../data/ratings";
import { useFindModel } from "../data/useModels";
import { useTestCaseName } from "../data/useTestCaseName";
import { formatReviewedAt } from "../pages/runs/[runId]/ReviewList";
import { ColumnMenu, type ColumnMenuHandle } from "./ColumnMenu";
import { SortableHeaderCell } from "./SortableHeaderCell";
import { useColumnVisibility } from "./useColumnVisibility";
import { useResizableColumns } from "./useResizableColumns";
import { routes } from "../routes";
import styles from "./RunLog.module.scss";

/**
 * One column of the reviews log. The same minimal shape the shared table
 * primitives consume — a resize track ({@link useResizableColumns}), a
 * hide/show entry ({@link useColumnVisibility}/{@link ColumnMenu}), and a
 * header cell — plus how it renders a review row. The account's Reviews tab is
 * a fixed newest-first server-paged listing (the backend offers no sort over
 * it), so — unlike the run log — these columns carry no sort key and their
 * headers show no sort affordance; the table stays column-adjustable (resize,
 * show/hide) without implying an ordering it can't honor across pages.
 */
interface ReviewColumn {
  id: string;
  label: string;
  default: string;
  min: number;
  /** A non-resizable gutter (no drag handle on its right edge). */
  resizable?: boolean;
  /** Right-aligned like a printed figure. */
  numeric?: boolean;
  optional?: boolean;
  defaultVisible?: boolean;
  render: (entry: MyReview, caseName: string, modelName: string) => ReactNode;
}

// This account's own verdict for a run: the worst rating across the domains it
// scored, or — for a game jam, which scores no domains — its whole-game overall
// grade (mirrors the run log's rating cell so the two tables read identically).
function reviewerVerdict(review: StoredReview): ReactNode {
  const rated = review.ratings.length > 0;
  const overall = rated ? worstRating(review.ratings.map((r) => r.rating)) : null;
  const grade = rated ? null : overallGradeOf(review.checklist);
  return (
    <span className={styles.rating} data-label="Rating">
      {grade ? (
        <GradeBadge status={grade} />
      ) : overall ? (
        <RatingBadge rating={overall} />
      ) : (
        <span className={styles.noRating}>&mdash;</span>
      )}
    </span>
  );
}

// The reviews log's columns, left→right: the caret gutter, the reviewed run's
// identity (test · harness · variant · model), the account's own rating, and
// when it reviewed. The identity columns mirror the run log's order and cell
// treatments so the two tables line up; every data column is optional so the
// picker can show or hide any of them.
const REVIEW_COLUMNS: readonly ReviewColumn[] = [
  {
    id: "caret",
    label: "",
    default: "1.2rem",
    min: 20,
    resizable: false,
    render: () => <span className={styles.rowCaret}>&rsaquo;</span>,
  },
  {
    id: "test",
    label: "TEST",
    default: "1fr",
    min: 96,
    optional: true,
    render: (_entry, caseName) => (
      <span className={styles.test}>
        <span className={styles.testName}>{caseName}</span>
      </span>
    ),
  },
  {
    id: "harness",
    label: "HARNESS",
    default: "7rem",
    min: 64,
    optional: true,
    render: (entry) => (
      <span className={styles.harness} data-label="Harness">
        {entry.run.subject.harnessSlug}
      </span>
    ),
  },
  {
    id: "variant",
    label: "VARIANT",
    default: "6rem",
    min: 56,
    optional: true,
    render: (entry) => (
      <span className={styles.variant} data-label="Variant">
        {entry.run.subject.variant}
      </span>
    ),
  },
  {
    id: "model",
    label: "MODEL",
    default: "1.6fr",
    min: 96,
    optional: true,
    render: (_entry, _caseName, modelName) => (
      <span className={styles.model} data-label="Model">
        {modelName}
      </span>
    ),
  },
  {
    id: "rating",
    label: "RATING",
    default: "6rem",
    min: 56,
    optional: true,
    render: (entry) => reviewerVerdict(entry.review),
  },
  {
    id: "reviewed",
    label: "REVIEWED",
    default: "9rem",
    min: 96,
    optional: true,
    render: (entry) => (
      <span className={styles.when} data-label="Reviewed">
        {entry.review.reviewedAt
          ? formatReviewedAt(entry.review.reviewedAt)
          : "—"}
      </span>
    ),
  },
];

interface ReviewLogProps {
  /** The account's reviews to list, newest first (server order). */
  reviews: readonly MyReview[];
  /** Dim the table while a new page loads, keeping the prior rows in place. */
  loading?: boolean;
}

// The account Reviews tab's table: the same dense, column-aligned, resizable log
// the runs listing uses (shared `RunLog.module.scss` styling and column
// primitives), but over the account's own reviews. Each row links to that
// review's page. Columns are user-resizable (drag the header boundaries) and any
// column can be shown or hidden via the picker (the ▦ button or a header
// right-click); the order is a fixed newest-first server page, so the headers
// don't sort.
export function ReviewLog({ reviews, loading }: ReviewLogProps) {
  const testCaseName = useTestCaseName();
  const findModel = useFindModel();
  const menuRef = useRef<ColumnMenuHandle>(null);
  const { isVisible, toggle } = useColumnVisibility(
    "ttc:reviewlog:visible",
    REVIEW_COLUMNS,
  );

  // The columns actually rendered this pass: the full set minus any the user has
  // hidden. Both the header and every row map over this, so they stay in lockstep
  // and the resize handles' indices line up with the header cells.
  const visible = useMemo(
    () => REVIEW_COLUMNS.filter((column) => isVisible(column.id)),
    [isVisible],
  );

  const table = useResizableColumns({
    storageKey: "ttc:reviewlog:widths",
    columns: visible,
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.menuAnchor}>
        <ColumnMenu
          ref={menuRef}
          columns={REVIEW_COLUMNS}
          isVisible={isVisible}
          onToggle={toggle}
        />
      </div>
      <div
        className={styles.log}
        data-scope="reviews"
        ref={table.containerRef}
        aria-busy={loading ? "true" : undefined}
      >
        <div
          className={`${styles.row} ${styles.head}`}
          data-ttc-head
          onContextMenu={(event) => {
            event.preventDefault();
            menuRef.current?.openAt(event.clientX, event.clientY);
          }}
        >
          {visible.map((column, index) => (
            <SortableHeaderCell
              key={column.id}
              columnId={column.id}
              label={column.label}
              numeric={column.numeric}
              sortable={false}
              sort={null}
              onSort={() => {}}
              handle={table.handle(index)}
            />
          ))}
        </div>
        {reviews.map((entry) => (
          <Link
            key={entry.run.id}
            to={routes.runReview(entry.run.id, entry.review.reviewerId)}
            className={styles.row}
          >
            {visible.map((column) => (
              <Fragment key={column.id}>
                {column.render(
                  entry,
                  testCaseName(entry.run.subject.testCaseSlug),
                  findModel(
                    entry.run.subject.modelId,
                    entry.run.subject.harnessSlug,
                  )?.name ?? canonicalModelId(entry.run.subject.modelId),
                )}
              </Fragment>
            ))}
          </Link>
        ))}
      </div>
    </div>
  );
}
