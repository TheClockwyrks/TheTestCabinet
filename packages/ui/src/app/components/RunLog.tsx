import type { RunRecord } from "@test-cabinet/run-record";
import { Fragment, useMemo, useRef } from "react";
import { Link } from "react-router";
import type { InProgressRun } from "../../client/types";
import { describeRunState } from "../data/runState";
import { useTestCaseName } from "../data/useTestCaseName";
import { ColumnMenu, type ColumnMenuHandle } from "./ColumnMenu";
import { SortableHeaderCell } from "./SortableHeaderCell";
import {
  columnsForScope,
  isSortable,
  sortRuns,
  useEnrichedRuns,
  type EnrichedRun,
  type RunColumn,
  type RunRenderContext,
  type RunScope,
} from "./runColumns";
import { useColumnVisibility } from "./useColumnVisibility";
import { useResizableColumns } from "./useResizableColumns";
import { useTableSort, type SortState } from "./useTableSort";
import { routes } from "../routes";
import styles from "./RunLog.module.scss";

// Kept for callers that still reference the scope names by this alias.
export type RunLogScope = RunScope;

/**
 * The state driving a run log's columns: which columns its scope offers, the
 * active sort, and which optional columns are shown. Produced by
 * {@link useRunTable} so a page can sort (and page) the full run set before
 * handing a slice to {@link RunLog} — sorting only the visible page would order
 * each page independently.
 */
export interface RunTableControls {
  scope: RunScope;
  columns: RunColumn[];
  sort: SortState | null;
  cycleSort: (columnId: string) => void;
  isVisible: (id: string) => boolean;
  toggle: (id: string) => void;
}

interface RunTable {
  /** Every run for this table, enriched and ordered by the active sort. */
  rows: EnrichedRun[];
  /** Column/sort/visibility state to hand to {@link RunLog}. */
  controls: RunTableControls;
}

interface UseRunTableArgs {
  /** The runs to list, in their default (recency) order. */
  runs: readonly RunRecord[];
  /** Ids of runs sourced from local disk — flagged as unpublished. */
  localIds: ReadonlySet<string>;
  /** Raw local writeups, keyed by run id, used to resolve a run's rating. */
  localWriteups: Readonly<Record<string, string>>;
  /** Column set to render. Defaults to the full cross-case layout. */
  scope?: RunScope;
}

/**
 * Enrich, sort, and expose the column controls for a run log. The returned
 * `rows` are the full set in sorted order; a page slices them and passes the
 * slice plus `controls` to {@link RunLog}. Sort and visibility persist per scope,
 * so the ordering and chosen columns are shared across the pages that use the
 * same layout (e.g. the home gallery and the all-runs index).
 */
export function useRunTable({
  runs,
  localIds,
  localWriteups,
  scope = "global",
}: UseRunTableArgs): RunTable {
  const columns = useMemo(() => columnsForScope(scope), [scope]);
  const { sort, cycle } = useTableSort(`ttc:runlog:${scope}:sort`);
  const { isVisible, toggle } = useColumnVisibility(
    `ttc:runlog:${scope}:visible`,
    columns,
  );
  const enriched = useEnrichedRuns(runs, localIds, localWriteups);
  const rows = useMemo(() => sortRuns(enriched, sort), [enriched, sort]);
  return {
    rows,
    controls: { scope, columns, sort, cycleSort: cycle, isVisible, toggle },
  };
}

interface RunLogProps {
  /** The runs to display — already enriched, sorted, and (if paged) sliced. */
  rows: readonly EnrichedRun[];
  /**
   * Runs still executing, rendered as spinner rows pinned above the finished
   * ones (each links to its live monitor instead of a run detail). A run gains no
   * record until it completes, so these can't be ordinary rows; they share the
   * table so the styling matches. Defaults to none.
   */
  active?: InProgressRun[];
  /** Column/sort/visibility state from {@link useRunTable}. */
  controls: RunTableControls;
}

// The dense, column-aligned run log shared by the home gallery and the per-case
// Runs tab. Columns are user-resizable (drag the header boundaries) and sortable
// (click a header to cycle ascending → descending → default), and any column can
// be shown or hidden via the picker (the ▦ button or a header right-click) —
// category/timestamp/duration merely start hidden. Rendering lives here so every page stays
// pixel-identical; the caller owns enrichment, sorting, slicing, and paging via
// useRunTable.
export function RunLog({ rows, active = [], controls }: RunLogProps) {
  const { scope, columns, sort, cycleSort, isVisible, toggle } = controls;
  const testCaseName = useTestCaseName();
  const menuRef = useRef<ColumnMenuHandle>(null);

  // The columns actually rendered this pass: the scope's set minus any the user
  // has hidden. Both the header and every row map over this, so they stay in
  // lockstep, and the resize handles' indices line up with the header cells.
  const visible = useMemo(
    () => columns.filter((column) => isVisible(column.id)),
    [columns, isVisible],
  );
  const visibleIds = useMemo(
    () => new Set(visible.map((column) => column.id)),
    [visible],
  );

  const table = useResizableColumns({
    storageKey: `ttc:runlog:${scope}:widths`,
    columns: visible,
  });

  const ctx: RunRenderContext = { visible: visibleIds, testCaseName };

  return (
    <div className={styles.wrap}>
      <div className={styles.menuAnchor}>
        <ColumnMenu
          ref={menuRef}
          columns={columns}
          isVisible={isVisible}
          onToggle={toggle}
        />
      </div>
      <div className={styles.log} data-scope={scope} ref={table.containerRef}>
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
              sortable={isSortable(column)}
              sort={sort}
              onSort={cycleSort}
              handle={table.handle(index)}
            />
          ))}
        </div>
        {active.map((run) => (
          <Link
            key={run.runId}
            to={routes.runMonitor(run.runId)}
            className={styles.row}
            data-active=""
            data-failed={run.state === "failed" ? "" : undefined}
          >
            {visible.map((column) => (
              <Fragment key={column.id}>
                {column.renderActive(run, ctx)}
              </Fragment>
            ))}
          </Link>
        ))}
        {rows.map((row) => (
          <RunRow key={row.record.id} row={row} columns={visible} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

function RunRow({
  row,
  columns,
  ctx,
}: {
  row: EnrichedRun;
  columns: readonly RunColumn[];
  ctx: RunRenderContext;
}) {
  // A failed run (any non-completed tier) is listed inline so the failure can be
  // inspected, marked with the same negative styling an active row uses; its
  // rating cell shows the failure tier instead of a badge.
  const failed = describeRunState(row.record.status.state).isFailure;
  return (
    <Link
      to={routes.runDetail(row.record.id)}
      className={styles.row}
      data-failed={failed ? "" : undefined}
    >
      {columns.map((column) => (
        <Fragment key={column.id}>{column.render(row, ctx)}</Fragment>
      ))}
    </Link>
  );
}
