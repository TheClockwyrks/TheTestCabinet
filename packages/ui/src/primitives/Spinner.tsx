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
// - `squadron` — the full squadron, drawn inside an arcade cabinet screen; use
//                for large, full-panel loading states (e.g. an implementation
//                that hasn't loaded yet).
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
   * omitted the small marks are decorative and labelled "Loading" for assistive
   * tech, with no visible caption; the `squadron` falls back to a visible
   * "Loading…" instead, since a cabinet screen with nothing on it reads as a
   * dead screen rather than a wait.
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
  const caption = label ?? (variant === "squadron" ? "Loading…" : undefined);
  return (
    <div className={classes} role="status" aria-live="polite">
      <img
        className={styles.art}
        src={SOURCES[variant]}
        alt={caption ? "" : "Loading"}
        draggable={false}
      />
      {caption ? <span className={styles.label}>{caption}</span> : null}
    </div>
  );
}
