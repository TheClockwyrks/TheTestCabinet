import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from "react";
import styles from "./ColumnMenu.module.scss";

/** A column offered in the picker. Only optional columns are listed. */
export interface ColumnMenuItem {
  id: string;
  label: string;
  optional?: boolean;
}

/** Imperative handle so a table can open the picker from a header right-click. */
export interface ColumnMenuHandle {
  /** Open the picker anchored at the given viewport coordinates. */
  openAt: (x: number, y: number) => void;
}

interface ColumnMenuProps {
  /** Ref exposing {@link ColumnMenuHandle.openAt} for a right-click trigger. */
  ref?: Ref<ColumnMenuHandle>;
  /** Every column of the table, in order; non-optional ones are skipped. */
  columns: readonly ColumnMenuItem[];
  /** Whether a column is currently shown. */
  isVisible: (id: string) => boolean;
  /** Toggle a column's visibility. */
  onToggle: (id: string) => void;
}

interface Anchor {
  x: number;
  y: number;
}

// Keep the popover fully on-screen: nudged in from each viewport edge by this
// margin when a cursor/button near the edge would otherwise clip it.
const VIEWPORT_MARGIN = 8;

/**
 * The column picker for a resizable table: a small always-visible trigger button
 * plus a popover of checkboxes for the table's optional columns. The popover
 * opens from the trigger (keyboard- and pointer-reachable) or, via the exposed
 * `openAt` handle, from a right-click on the header — so the feature is
 * discoverable without relying on right-click alone.
 */
export function ColumnMenu({
  ref,
  columns,
  isVisible,
  onToggle,
}: ColumnMenuProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const optional = columns.filter((col) => col.optional);

  useImperativeHandle(
    ref,
    () => ({
      openAt: (x, y) => setAnchor({ x, y }),
    }),
    [],
  );

  const close = useCallback(() => setAnchor(null), []);

  const openFromTrigger = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor((current) =>
      current ? null : { x: rect.left, y: rect.bottom + 4 },
    );
  }, []);

  // Dismiss on outside pointerdown or Escape while open.
  useEffect(() => {
    if (!anchor) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, close]);

  // Once positioned, clamp the popover inside the viewport so a near-edge anchor
  // doesn't push it off-screen.
  useLayoutEffect(() => {
    if (!anchor) return;
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let { x, y } = anchor;
    const maxX = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    const maxY = window.innerHeight - rect.height - VIEWPORT_MARGIN;
    x = Math.max(VIEWPORT_MARGIN, Math.min(x, maxX));
    y = Math.max(VIEWPORT_MARGIN, Math.min(y, maxY));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [anchor]);

  if (optional.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={anchor ? true : false}
        aria-label="Choose columns"
        title="Choose columns"
        onClick={openFromTrigger}
      >
        <span aria-hidden="true">▦</span>
      </button>
      {anchor && (
        <div
          ref={popoverRef}
          className={styles.popover}
          role="menu"
          aria-label="Choose columns"
          // Initial placement at the anchor; the layout effect clamps it into the
          // viewport once measured. Set inline so it never flashes at the corner.
          style={{ left: anchor.x, top: anchor.y }}
        >
          <p className={styles.heading}>Columns</p>
          {optional.map((col) => (
            <label key={col.id} className={styles.item} role="menuitemcheckbox" aria-checked={isVisible(col.id)}>
              <input
                type="checkbox"
                checked={isVisible(col.id)}
                onChange={() => onToggle(col.id)}
              />
              <span>{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </>
  );
}
