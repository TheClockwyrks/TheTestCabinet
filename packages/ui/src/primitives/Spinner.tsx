import styles from "./Spinner.module.scss";
import flapUrl from "./loading/arcade-flap.svg?url";
import marchUrl from "./loading/arcade-march.svg?url";
import squadronUrl from "./loading/arcade-squadron.svg?url";

// The Test Cabinet's arcade-themed loading marks. Each is a self-contained,
// CSS-animated SVG (its `<style>`/`@keyframes` run even when loaded via `<img>`,
// which also keeps their shared element ids isolated per document):
//
// - `flap`     — a single flapping sprite; use for small/inline spinners.
// - `march`    — a marching column; a mid-size option, kept on hand.
// - `squadron` — the full squadron; use for large, full-panel loading states
//                (e.g. an implementation that hasn't loaded yet).
export type SpinnerVariant = "flap" | "march" | "squadron";

const SOURCES: Record<SpinnerVariant, string> = {
  flap: flapUrl,
  march: marchUrl,
  squadron: squadronUrl,
};

export interface SpinnerProps {
  /** Which arcade animation to show. Defaults to the small `flap`. */
  variant?: SpinnerVariant;
  /**
   * Text shown beneath the animation and used as its accessible label. When
   * omitted the animation is decorative and labelled "Loading" for assistive
   * tech, with no visible caption.
   */
  label?: string;
  className?: string;
}

// A branded loading indicator. The whole thing is a `role="status"` region so
// screen readers announce it; the animation itself is an `<img>` whose alt is
// empty (the caption carries the meaning) or falls back to "Loading".
export function Spinner({ variant = "flap", label, className }: SpinnerProps) {
  const classes = [styles.spinner, styles[variant], className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} role="status" aria-live="polite">
      <img
        className={styles.art}
        src={SOURCES[variant]}
        alt={label ? "" : "Loading"}
        draggable={false}
      />
      {label ? <span className={styles.label}>{label}</span> : null}
    </div>
  );
}
