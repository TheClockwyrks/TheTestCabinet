import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import styles from "./RunLog.module.scss";

/**
 * A run resolved to just what the batch context menu needs to act on it: its id,
 * whether it's still in progress (so it opens its live monitor and may be killed),
 * and the three subjects the "open test case / model" links target. Built by the
 * run log for every listed row so a selection resolves to a self-contained set.
 */
export interface SelectableRun {
  id: string;
  /** In-progress: it opens its live monitor rather than a run detail. */
  active: boolean;
  /** In-progress and still cancelable (not one already observed to have failed). */
  killable: boolean;
  testCaseSlug: string;
  modelId: string;
  harnessSlug: string;
}

/**
 * The per-row selection controls a caret cell needs, threaded through the column
 * render context so the caret column can render a checkbox without the columns
 * owning the selection state.
 */
export interface RunSelectionContext {
  isSelected: (id: string) => boolean;
  /** Toggle a run; `range` extends a contiguous span from the last toggle (shift). */
  toggle: (id: string, opts?: { range?: boolean }) => void;
}

/** The full selection controller the run log holds; a superset of the row context. */
export interface RunSelection extends RunSelectionContext {
  /** The selected run ids (unordered). */
  selected: ReadonlySet<string>;
  /** Select every listed run. */
  selectAll: () => void;
  /** Drop the whole selection. */
  clear: () => void;
}

/**
 * Multi-select state for the run log, keyed by run id and scoped to the rows
 * currently listed. `orderedIds` is every row in render order (the pinned active
 * runs, then the finished rows); it drives shift-click range selection and prunes
 * the selection down to what's still on screen when the page or filter changes, so
 * a batch action never targets a run the user can no longer see.
 */
export function useRunSelection(orderedIds: readonly string[]): RunSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The last row toggled, as the anchor a subsequent shift-click extends from.
  const anchor = useRef<string | null>(null);

  const present = useMemo(() => new Set(orderedIds), [orderedIds]);

  // Drop ids no longer listed (a page turn, a new search, a run just deleted) so
  // the selection can't retain runs that have scrolled off the current view.
  useEffect(() => {
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (present.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [present]);

  const toggle = useCallback(
    (id: string, opts?: { range?: boolean }) => {
      setSelected((prev) => {
        // Shift-click: add the contiguous span from the anchor to here, the
        // range-select gesture users expect from a checkbox list.
        if (opts?.range && anchor.current) {
          const from = orderedIds.indexOf(anchor.current);
          const to = orderedIds.indexOf(id);
          if (from !== -1 && to !== -1) {
            const [lo, hi] = from <= to ? [from, to] : [to, from];
            const next = new Set(prev);
            for (let i = lo; i <= hi; i += 1) next.add(orderedIds[i]!);
            return next;
          }
        }
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchor.current = id;
    },
    [orderedIds],
  );

  const selectAll = useCallback(
    () => setSelected(new Set(orderedIds)),
    [orderedIds],
  );
  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return { selected, isSelected, toggle, clear, selectAll };
}

// A checkbox glyph shared by the row and header controls: a styled box we own
// (rather than a native <input>) so it can live inside the row's link and its
// visibility can be driven by the row's hover/selected state in CSS.
function checkboxHandlers(toggle: (range: boolean) => void) {
  const onClick = (event: ReactMouseEvent) => {
    // The box sits inside the row's <a>; keep a toggle from also navigating.
    event.preventDefault();
    event.stopPropagation();
    toggle(event.shiftKey);
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      toggle(event.shiftKey);
    }
  };
  return { onClick, onKeyDown };
}

/**
 * The per-row selection control shown in the caret gutter when the log is
 * selectable. The whole cell is the checkbox — it carries the role and the click
 * handler and fills the entire gutter column, so a click anywhere in that column
 * toggles the selection instead of falling through to the row's link and opening
 * the run. The little box inside is only the visual: invisible at rest (like the
 * caret it replaces), fading in on row hover or whenever the row is selected, and
 * overlaying the live spinner an in-progress row shows through until hovered.
 */
export function RunSelectBox({
  id,
  active = false,
  selection,
}: {
  id: string;
  active?: boolean;
  selection: RunSelectionContext;
}) {
  const selected = selection.isSelected(id);
  const { onClick, onKeyDown } = checkboxHandlers((range) =>
    selection.toggle(id, { range }),
  );
  return (
    <span
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? "Deselect run" : "Select run"}
      tabIndex={0}
      className={styles.selectCell}
      data-selected={selected ? "" : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {active && <span className={styles.spinner} aria-hidden="true" />}
      <span className={styles.selectBox} aria-hidden="true" />
    </span>
  );
}

/**
 * The select-all control shown in the caret gutter's header cell: checked when
 * every listed run is selected, "mixed" when only some are, and empty otherwise.
 * Toggling selects all or, when all are already selected, clears the selection.
 * Like the row control the whole cell is the checkbox, for a large hit target.
 */
export function RunSelectAll({
  total,
  selectedCount,
  onToggleAll,
}: {
  total: number;
  selectedCount: number;
  onToggleAll: () => void;
}) {
  const all = total > 0 && selectedCount === total;
  const some = selectedCount > 0 && !all;
  const { onClick, onKeyDown } = checkboxHandlers(() => onToggleAll());
  return (
    <span
      role="checkbox"
      aria-checked={all ? true : some ? "mixed" : false}
      aria-label={all ? "Deselect all runs" : "Select all runs"}
      tabIndex={0}
      className={styles.selectAllCell}
      data-selected={all ? "" : undefined}
      data-mixed={some ? "" : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span className={styles.selectBox} aria-hidden="true" />
    </span>
  );
}
