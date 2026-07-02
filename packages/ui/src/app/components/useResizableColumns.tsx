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
 * `default` is the track's resting size — any valid `grid-template-columns`
 * value (`"1fr"`, `"7rem"`, …). It's used verbatim until the user drags this
 * column, so an untouched table renders pixel-identically to its static SCSS
 * template. `min` is the floor (in px) a drag can shrink the column to.
 * A column with `resizable: false` gets no drag handle on its right edge (e.g.
 * a caret gutter).
 */
export interface ResizableColumn {
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
  /** One entry per grid track, in render order. Must be a stable reference. */
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

// A pinned width per column, or null to keep the column's `default` track. Only
// columns the user has actually dragged are pinned; the rest keep flexing, so
// the table still fills its container the way its static template did.
type Widths = (number | null)[];

function loadWidths(storageKey: string, count: number): Widths | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === count &&
      parsed.every(
        (n) =>
          n === null || (typeof n === "number" && Number.isFinite(n) && n > 0),
      )
    ) {
      return parsed as Widths;
    }
  } catch {
    // Corrupt or unavailable storage: fall back to the default template.
  }
  return null;
}

function saveWidths(storageKey: string, widths: Widths): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (widths.every((w) => w == null)) localStorage.removeItem(storageKey);
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
 * <default>)`). Dragging pins the grabbed column to a pixel width and leaves the
 * others on their default tracks, so flexible columns keep absorbing slack.
 * Widths persist under `storageKey`. During a drag the property is written
 * imperatively so only the container restyles — the rows never re-render.
 */
export function useResizableColumns({
  storageKey,
  columns,
  enabled = true,
}: Options): Resizable {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const count = columns.length;
  const [widths, setWidths] = useState<Widths | null>(() =>
    enabled ? loadWidths(storageKey, count) : null,
  );
  // Mirrors `widths` for event handlers so a drag always starts from the latest
  // committed state without re-subscribing listeners on every change.
  const widthsRef = useRef<Widths | null>(widths);
  const draggingRef = useRef(false);

  const applyTemplate = useCallback(
    (ws: Widths | null) => {
      const el = containerRef.current;
      if (!el) return;
      if (!enabled || !ws) {
        el.style.removeProperty("--ttc-cols");
        return;
      }
      const tracks = columns.map((col, i) => {
        const w = ws[i];
        return w == null ? col.default : `${w}px`;
      });
      el.style.setProperty("--ttc-cols", tracks.join(" "));
    },
    [columns, enabled],
  );

  // Apply committed widths on mount and whenever they change — but never stomp
  // an in-flight drag, which drives the property imperatively.
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
      const base = widthsRef.current
        ? widthsRef.current.slice()
        : columns.map(() => null);
      let latest: Widths = base;

      const onMove = (e: PointerEvent) => {
        const next = base.slice();
        next[index] = Math.max(
          col.min,
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
      if (!enabled || !col || index >= count - 1 || col.resizable === false) {
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
    [columns, count, enabled, onPointerDown],
  );

  return { containerRef, handle };
}
