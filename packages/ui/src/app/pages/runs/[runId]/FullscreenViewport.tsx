import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./RunDetailPages.module.scss";

/** The default overlay hint. A 3D preview both rotates and zooms; a caller whose
 * view locks rotation (a planar 2D effect) passes its own. */
const DEFAULT_HINT = "Drag to rotate · scroll to zoom · Esc to close";

/**
 * The full-viewport expanded view: a fixed, near-opaque sheet portalled over the page
 * (so it escapes any panel's overflow/stacking) holding the caller's expanded content,
 * a close button, an Escape-to-dismiss handler, and a live height that tracks the
 * window. The expanded content is built by {@link renderExpanded} rather than reusing
 * the inline node because the expanded view differs — a taller canvas, scroll-to-zoom
 * enabled — and its height is only known once expanded.
 */
function FullscreenOverlay({
  label,
  hint,
  renderExpanded,
  onClose,
}: {
  label: string;
  hint: string;
  renderExpanded: (height: number) => ReactNode;
  onClose: () => void;
}) {
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? 600 : Math.round(window.innerHeight * 0.9),
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onResize = () => setHeight(Math.round(window.innerHeight * 0.9));
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  return createPortal(
    <div
      className={styles.viewerFullscreen}
      role="dialog"
      aria-modal="true"
      aria-label={`${label} — expanded`}
    >
      <button
        type="button"
        className={styles.viewerFullscreenClose}
        onClick={onClose}
        aria-label="Close expanded view"
      >
        Close ✕
      </button>
      <div className={styles.viewerFullscreenStage}>
        {renderExpanded(height)}
      </div>
      <p className={styles.viewerFullscreenHint}>{hint}</p>
    </div>,
    document.body,
  );
}

/**
 * A viewer-agnostic fullscreen scaffold. Renders `children` as the inline stage with
 * an unobtrusive "expand" button floated over its top-right corner; when expanded, it
 * portals a near-opaque overlay over the page holding `renderExpanded(height)`, with a
 * close button, Escape-to-dismiss, and a viewport height that tracks the window.
 *
 * Shared by the voxel, skinned, and particle result viewers so every 3D / live preview
 * expands the same way. The expanded content is a render prop (not the same node as
 * `children`) because it differs from the inline view — a taller canvas, scroll-to-zoom
 * enabled — and its height is only known at expand time. The caller wraps its own lazy
 * viewer in `<Suspense>` inside both `children` and `renderExpanded`.
 */
export function FullscreenViewport({
  label,
  expandable = true,
  hint = DEFAULT_HINT,
  children,
  renderExpanded,
}: {
  /** Accessible name of the thing being viewed (e.g. an animation or effect name). */
  label: string;
  /** Whether to offer the expand button. On by default. */
  expandable?: boolean;
  /** The overlay's control hint. Defaults to the rotate+zoom line. */
  hint?: string;
  /** The inline stage content. */
  children: ReactNode;
  /** Builds the expanded content given the available viewport height (px). */
  renderExpanded: (height: number) => ReactNode;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <div className={styles.viewerStage}>
      {children}
      {expandable && (
        <button
          type="button"
          className={styles.viewerExpandButton}
          onClick={() => setFullscreen(true)}
          aria-label={`Expand ${label} to fullscreen`}
          title="Expand"
        >
          ⛶
        </button>
      )}
      {fullscreen && (
        <FullscreenOverlay
          label={label}
          hint={hint}
          renderExpanded={renderExpanded}
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  );
}
