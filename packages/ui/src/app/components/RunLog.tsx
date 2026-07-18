import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { Fragment, useMemo, useRef, type MouseEvent } from "react";
import { Link } from "react-router";
import type { RunSort, SortDir } from "../../client/clients";
import type { InProgressRun } from "../../client/types";
import { describeRunState } from "../data/runState";
import { useTestCaseName } from "../data/useTestCaseName";
import { useTestCaseType } from "../data/useTestCaseType";
import { ColumnMenu, type ColumnMenuHandle } from "./ColumnMenu";
import { RunContextMenu, type RunContextMenuHandle } from "./RunContextMenu";
import { RunSelectAll, useRunSelection, type SelectableRun } from "./RunSelect";
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
  /** The run summaries to list, in their default (recency) order. */
  runs: readonly RunSummary[];
  /** Ids of runs sourced from local disk — flagged as unpublished. */
  localIds: ReadonlySet<string>;
  /** Raw local writeups, keyed by run id, used to resolve a run's rating. */
  localWriteups: Readonly<Record<string, string>>;
  /** Column set to render. Defaults to the full cross-case layout. */
  scope?: RunScope;
  /**
   * Render `runs` in the order given rather than re-sorting them by the active
   * sort — for a page whose data source already returned the rows ordered (a
   * server-paged listing). The sort state and header cycle still work exactly as
   * usual, so the page can read {@link RunTableControls.sort}, map it with
   * {@link sortStateToQuery}, and re-query the server; the headers just no longer
   * reorder an already-ordered page in the browser. Defaults to false, where the
   * table sorts `runs` itself (the static/client-paged pages).
   */
  externalOrder?: boolean;
}

/**
 * Enrich, sort, and expose the column controls for a run log. The returned
 * `rows` are the full set in sorted order; a page slices them and passes the
 * slice plus `controls` to {@link RunLog}. Sort and visibility persist per scope,
 * so the ordering and chosen columns are shared across the pages that use the
 * same layout (e.g. the home gallery and the all-runs index).
 *
 * With `externalOrder`, the table skips its own sort and renders `runs` in the
 * given order (the page's data source already ordered them, e.g. a server-paged
 * query); the sort STATE and header cycle are unchanged so the page can read the
 * active sort and drive its re-query from it.
 */
export function useRunTable({
  runs,
  localIds,
  localWriteups,
  scope = "global",
  externalOrder = false,
}: UseRunTableArgs): RunTable {
  const columns = useMemo(() => columnsForScope(scope), [scope]);
  const { sort, cycle } = useTableSort(`ttc:runlog:${scope}:sort`);
  const { isVisible, toggle } = useColumnVisibility(
    `ttc:runlog:${scope}:visible`,
    columns,
  );
  const enriched = useEnrichedRuns(runs, localIds, localWriteups);
  const rows = useMemo(
    () => (externalOrder ? enriched : sortRuns(enriched, sort)),
    [enriched, sort, externalOrder],
  );
  return {
    rows,
    controls: { scope, columns, sort, cycleSort: cycle, isVisible, toggle },
  };
}

// The server sort key each run column drives, keyed by column id. A column absent
// here has no server-side equivalent (the caret gutter; the VERSION column — the
// backend has no test-case-version sort), so {@link sortStateToQuery} falls back
// to the default `date`/`desc` query for it: the header still highlights, and the
// data simply comes back date-ordered. Note the two id differences from the sort
// tokens: the TIMESTAMP column maps to `date` and the DURATION column to `runtime`.
const COLUMN_SORT_KEYS: Readonly<Record<string, RunSort>> = {
  test: "testCase",
  category: "testType",
  harness: "harness",
  variant: "variant",
  model: "model",
  timestamp: "date",
  duration: "runtime",
  tokens: "tokens",
  cost: "cost",
  rating: "rating",
};

/**
 * Map a run table's active sort state to the `{ sort, dir }` a summary query
 * takes, so an `externalOrder` page can re-query the server in the order its
 * headers show. A null sort (the table's default order) and any column with no
 * server key both resolve to the default `date`/`desc`.
 */
export function sortStateToQuery(sort: SortState | null): {
  sort: RunSort;
  dir: SortDir;
} {
  if (!sort) return { sort: "date", dir: "desc" };
  const key = COLUMN_SORT_KEYS[sort.columnId];
  if (!key) return { sort: "date", dir: "desc" };
  return { sort: key, dir: sort.direction };
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
  /**
   * Turn on multi-select: the caret gutter becomes a per-row checkbox (with a
   * select-all in its header), and once any run is checked a right-click anywhere
   * in the log opens a batch menu acting on the whole selected set (open each in a
   * new tab, open the de-duped test cases or models, kill the still-running ones,
   * delete the deletable ones) instead of the single-run menu. Off by default, so
   * every other run log is unchanged. Selection is scoped to the rows currently
   * listed and clears as they change (a page turn, a new search).
   */
  selectable?: boolean;
}

// The dense, column-aligned run log shared by the home gallery and the per-case
// Runs tab. Columns are user-resizable (drag the header boundaries) and sortable
// (click a header to cycle ascending → descending → default), and any column can
// be shown or hidden via the picker (the ▦ button or a header right-click) —
// category/timestamp/duration merely start hidden. Right-clicking a finished row
// opens a per-run menu (open in a new tab, jump to the test case or model, copy
// the run's link, and — on the consoles — delete an unpublished run); with
// `selectable`, checking one or more rows turns that into a batch menu over the
// whole selection. Rendering lives here so every page stays pixel-identical; the
// caller owns enrichment, sorting, slicing, and paging via useRunTable.
export function RunLog({
  rows,
  active = [],
  controls,
  selectable = false,
}: RunLogProps) {
  const { scope, columns, sort, cycleSort, isVisible, toggle } = controls;
  const testCaseName = useTestCaseName();
  const testCaseType = useTestCaseType();
  const menuRef = useRef<ColumnMenuHandle>(null);
  const rowMenuRef = useRef<RunContextMenuHandle>(null);

  // Every listed run in render order — the pinned active runs, then the finished
  // rows — as the id list the selection is scoped to (and shift-range ordered by).
  const orderedIds = useMemo(
    () => [...active.map((run) => run.runId), ...rows.map((r) => r.summary.id)],
    [active, rows],
  );
  const selection = useRunSelection(orderedIds);

  // Each listed run resolved to what the batch menu needs to act on it, so a set
  // of selected ids resolves to self-contained descriptors (an active run opens
  // its live monitor and may be killed; a finished run opens its detail).
  const selectableRuns = useMemo(() => {
    const map = new Map<string, SelectableRun>();
    for (const run of active) {
      map.set(run.runId, {
        id: run.runId,
        active: true,
        killable: run.state !== "failed",
        testCaseSlug: run.testCaseSlug,
        modelId: run.modelId,
        harnessSlug: run.harnessSlug,
      });
    }
    for (const row of rows) {
      const { subject } = row.summary;
      map.set(row.summary.id, {
        id: row.summary.id,
        active: false,
        killable: false,
        testCaseSlug: subject.testCaseSlug,
        modelId: subject.modelId,
        harnessSlug: subject.harnessSlug,
      });
    }
    return map;
  }, [active, rows]);

  const hasSelection = selectable && selection.selected.size > 0;

  // Route a row right-click: with a live selection, open the batch menu over the
  // whole selected set (resolved in render order); otherwise the single-run menu
  // for the row itself. An active row carries no summary, so with no selection it
  // opens nothing (as before) — check it first to act on it via the batch menu.
  const openRowMenu = (event: MouseEvent, summary?: RunSummary) => {
    event.preventDefault();
    if (hasSelection) {
      const runs = orderedIds
        .filter((id) => selection.selected.has(id))
        .map((id) => selectableRuns.get(id))
        .filter((run): run is SelectableRun => run != null);
      rowMenuRef.current?.openAt(event.clientX, event.clientY, {
        kind: "batch",
        runs,
      });
      return;
    }
    if (summary) {
      rowMenuRef.current?.openAt(event.clientX, event.clientY, {
        kind: "single",
        run: summary,
      });
    }
  };

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

  const ctx: RunRenderContext = {
    visible: visibleIds,
    testCaseName,
    testCaseType,
    selection: selectable ? selection : undefined,
  };

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
      {hasSelection && (
        <div className={styles.selectionBar}>
          <span className={styles.selectionCount}>
            {selection.selected.size} selected
          </span>
          <span className={styles.selectionHint}>Right-click for actions</span>
          <button
            type="button"
            className={styles.selectionClear}
            onClick={selection.clear}
          >
            Clear
          </button>
        </div>
      )}
      <div className={styles.log} data-scope={scope} ref={table.containerRef}>
        <div
          className={`${styles.row} ${styles.head}`}
          data-ttc-head
          onContextMenu={(event) => {
            event.preventDefault();
            menuRef.current?.openAt(event.clientX, event.clientY);
          }}
        >
          {visible.map((column, index) =>
            selectable && column.id === "caret" ? (
              <RunSelectAll
                key={column.id}
                total={orderedIds.length}
                selectedCount={selection.selected.size}
                onToggleAll={() =>
                  selection.selected.size === orderedIds.length &&
                  orderedIds.length > 0
                    ? selection.clear()
                    : selection.selectAll()
                }
              />
            ) : (
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
            ),
          )}
        </div>
        {active.map((run) => (
          <Link
            key={run.runId}
            to={routes.runMonitor(run.runId)}
            className={styles.row}
            data-active=""
            data-failed={run.state === "failed" ? "" : undefined}
            // Active rows carry no summary for a single-run menu, but they can join
            // a batch selection, so a right-click still routes through the log.
            onContextMenu={(event) => openRowMenu(event)}
          >
            {visible.map((column) => (
              <Fragment key={column.id}>
                {column.renderActive(run, ctx)}
              </Fragment>
            ))}
          </Link>
        ))}
        {rows.map((row) => (
          <RunRow
            key={row.summary.id}
            row={row}
            columns={visible}
            ctx={ctx}
            onContextMenu={(event) => openRowMenu(event, row.summary)}
          />
        ))}
      </div>
      <RunContextMenu ref={rowMenuRef} onBatchActed={selection.clear} />
    </div>
  );
}

function RunRow({
  row,
  columns,
  ctx,
  onContextMenu,
}: {
  row: EnrichedRun;
  columns: readonly RunColumn[];
  ctx: RunRenderContext;
  onContextMenu: (event: MouseEvent) => void;
}) {
  // A failed run (any non-completed tier) is listed inline so the failure can be
  // inspected, marked with the same negative styling an active row uses; its
  // rating cell shows the failure tier instead of a badge.
  const failed = describeRunState(row.summary.state).isFailure;
  return (
    <Link
      to={routes.runDetail(row.summary.id)}
      className={styles.row}
      data-failed={failed ? "" : undefined}
      onContextMenu={onContextMenu}
    >
      {columns.map((column) => (
        <Fragment key={column.id}>{column.render(row, ctx)}</Fragment>
      ))}
    </Link>
  );
}
