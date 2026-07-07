import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import styles from "./useResizableColumns.module.scss";

/**
 * One grid track of a resizable table, left→right.
 *
 * `id` is a stable key for the track — persisted widths are stored under it, so
 * a column keeps its width even when the visible set changes (a column toggled
 * off and back on, or a differently-scoped table that shares some columns).
 *
 * `default` is the track's resting size — any valid `grid-template-columns`
 * value (`"1fr"`, `"7rem"`, …). It's used verbatim until the user drags this
 * column, so an untouched table renders pixel-identically to its static SCSS
 * template. `min` is the floor (in px) a drag can shrink the column to — the
 * effective floor is raised to the header label's own width so a column can
 * never be dragged narrower than its label (see the label clamp below). A
 * column with `resizable: false` gets no drag handle on its right edge (e.g. a
 * caret gutter).
 */
export interface ResizableColumn {
  id: string;
  default: string;
  min: number;
  resizable?: boolean;
}

interface Options {
  /**
   * Stable id under which the resolved widths are persisted. Tables that should
   * share widths (e.g. the same run log on two pages) pass the same key.
   */
  storageKey: string;
  /**
   * The grid tracks currently rendered, in render order. May change as columns
   * are shown/hidden; widths are keyed by column `id`, not position, so a
   * changing set doesn't disturb the widths of the columns that remain.
   */
  columns: ResizableColumn[];
  /**
   * When false the table renders exactly as before — no handles, no persisted
   * override. Lets a shared component opt specific instances in.
   */
  enabled?: boolean;
}

interface Resizable {
  /** Ref for the grid container — the element that carries `--ttc-cols`. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * The drag handle for the boundary on the right of column `index`, to place
   * at the end of that column's header cell. Returns null for the last column,
   * a non-resizable column, or a disabled table — so callers can invoke it
   * unconditionally on every header cell.
   */
  handle: (index: number) => ReactNode;
}

// A pinned pixel width per column id. Columns the user hasn't dragged are absent
// and keep flexing on their `default` track, so the table still fills its
// container the way its static template did.
type Widths = Record<string, number>;

// Extra room, in px, added over the header label's measured width when clamping
// a drag's floor: enough to clear the numeric cells' right inset and the resize
// handle so the label never abuts either edge.
const LABEL_CLEARANCE = 12;

function loadWidths(storageKey: string): Widths {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const widths: Widths = {};
      for (const [id, value] of Object.entries(parsed)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          widths[id] = value;
        }
      }
      return widths;
    }
  } catch {
    // Corrupt or unavailable storage: fall back to the default template.
  }
  return {};
}

function saveWidths(storageKey: string, widths: Widths): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (Object.keys(widths).length === 0) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch {
    // Non-fatal: the widths just won't survive a reload.
  }
}

/**
 * Makes a CSS-grid "table" (a container whose header and rows share one
 * `grid-template-columns`) user-resizable by dragging the boundaries between
 * header cells.
 *
 * The mechanism is a single custom property, `--ttc-cols`, set on the
 * container and read by the row template (`grid-template-columns: var(--ttc-cols,
 * <default>)`). Each track resolves to its pinned pixel width if the user has
 * dragged it, else its `default` (so flexible columns keep absorbing slack).
 * Widths persist under `storageKey`, keyed by column id. During a drag the
 * property is written imperatively so only the container restyles — the rows
 * never re-render.
 */
export function useResizableColumns({
  storageKey,
  columns,
  enabled = true,
}: Options): Resizable {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [widths, setWidths] = useState<Widths>(() =>
    enabled ? loadWidths(storageKey) : {},
  );
  // Mirrors `widths` for event handlers so a drag always starts from the latest
  // committed state without re-subscribing listeners on every change.
  const widthsRef = useRef<Widths>(widths);
  const draggingRef = useRef(false);

  const applyTemplate = useCallback(
    (ws: Widths) => {
      const el = containerRef.current;
      if (!el) return;
      if (!enabled) {
        el.style.removeProperty("--ttc-cols");
        return;
      }
      const tracks = columns.map((col) => {
        const w = ws[col.id];
        return w == null ? col.default : `${w}px`;
      });
      el.style.setProperty("--ttc-cols", tracks.join(" "));
    },
    [columns, enabled],
  );

  // Apply committed widths on mount and whenever they (or the visible column
  // set) change — but never stomp an in-flight drag, which drives the property
  // imperatively.
  useLayoutEffect(() => {
    if (draggingRef.current) return;
    applyTemplate(widths);
  }, [applyTemplate, widths]);

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const commit = useCallback(
    (next: Widths) => {
      widthsRef.current = next;
      setWidths(next);
      saveWidths(storageKey, next);
    },
    [storageKey],
  );

  const onPointerDown = useCallback(
    (index: number, event: ReactPointerEvent) => {
      const el = containerRef.current;
      const col = columns[index];
      if (!el || !col) return;
      const head = el.querySelector<HTMLElement>("[data-ttc-head]");
      const cell = head?.children[index] as HTMLElement | undefined;
      if (!cell) return;

      // Freeze from the column's current rendered width so the first pixel of
      // drag is seamless, whatever its default track resolved to.
      const startWidth = cell.getBoundingClientRect().width;
      const startX = event.clientX;
      // The column can't be dragged narrower than its own header label (plus a
      // little clearance), so an overlong label never spills past its cell. The
      // label is marked with `data-ttc-label`; fall back to the column's own
      // `min` when a table doesn't mark one.
      const label = cell.querySelector<HTMLElement>("[data-ttc-label]");
      const labelFloor = label
        ? Math.ceil(label.getBoundingClientRect().width) + LABEL_CLEARANCE
        : 0;
      const floor = Math.max(col.min, labelFloor);
      const base: Widths = { ...widthsRef.current };
      let latest: Widths = base;

      const onMove = (e: PointerEvent) => {
        const next = { ...base };
        next[col.id] = Math.max(
          floor,
          Math.round(startWidth + (e.clientX - startX)),
        );
        latest = next;
        applyTemplate(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        draggingRef.current = false;
        commit(latest);
      };

      draggingRef.current = true;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      // Keep the resize cursor and suppress text selection for the whole drag,
      // even as the pointer leaves the thin handle.
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      event.preventDefault();
    },
    [applyTemplate, columns, commit],
  );

  const handle = useCallback(
    (index: number): ReactNode => {
      const col = columns[index];
      if (
        !enabled ||
        !col ||
        index >= columns.length - 1 ||
        col.resizable === false
      ) {
        return null;
      }
      return (
        <span
          className={styles.handle}
          // A pointer-only affordance layered over an aria-hidden header; the
          // underlying table stays fully readable without it.
          aria-hidden="true"
          onPointerDown={(e) => onPointerDown(index, e)}
        />
      );
    },
    [columns, enabled, onPointerDown],
  );

  return { containerRef, handle };
}
