import type { ReactNode } from "react";
import { ariaSortFor, type SortState } from "./useTableSort";
import styles from "./SortableHeaderCell.module.scss";

interface SortableHeaderCellProps {
  /** The column's id, matched against the table's active sort. */
  columnId: string;
  /** The header text. An empty label renders an empty cell (e.g. a gutter). */
  label: string;
  /** Right-align the label like the numeric figures it heads. */
  numeric?: boolean;
  /** Whether this column offers a sort. Defaults to true. */
  sortable?: boolean;
  /** The table's active sort. */
  sort: SortState | null;
  /** Advance the sort when the header is clicked. */
  onSort: (columnId: string) => void;
  /** The resize handle for this column's right edge, if any. */
  handle?: ReactNode;
}

/**
 * A header cell shared by the resizable tables. A sortable column renders a
 * button that cycles the sort and shows the active direction (a faint ↕ marks an
 * unsorted-but-sortable column so the affordance is discoverable); a gutter
 * renders nothing. The label carries `data-ttc-label` so the resize clamp can
 * measure it, and the cell is the positioning context for the drag handle.
 */
export function SortableHeaderCell({
  columnId,
  label,
  numeric,
  sortable = true,
  sort,
  onSort,
  handle,
}: SortableHeaderCellProps) {
  const active = sort?.columnId === columnId;
  const arrow = !active ? "↕" : sort?.direction === "asc" ? "▲" : "▼";
  return (
    <span
      className={styles.cell}
      data-numeric={numeric ? "" : undefined}
      role="columnheader"
      aria-sort={sortable ? ariaSortFor(columnId, sort) : undefined}
    >
      {sortable && label ? (
        <button
          type="button"
          className={styles.sortButton}
          data-ttc-label
          data-active={active ? "" : undefined}
          aria-label={`Sort by ${label}`}
          onClick={() => onSort(columnId)}
        >
          <span>{label}</span>
          <span className={styles.sortArrow} aria-hidden="true">
            {arrow}
          </span>
        </button>
      ) : (
        label && <span data-ttc-label>{label}</span>
      )}
      {handle}
    </span>
  );
}
