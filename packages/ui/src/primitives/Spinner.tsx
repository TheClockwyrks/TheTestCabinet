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

// Each mark's file and its INTRINSIC SIZE, taken from the `width`/`height` on
// the SVG itself. The size is carried here because it has to reach the `<img>`
// as attributes: an `<img>` with no attributes and nothing loaded yet has no
// intrinsic ratio, so whichever axis CSS leaves as `auto` computes to zero
// until the SVG arrives. The fitted `squadron` sizes by height, so the mark
// laid out 0 wide — the cabinet collapsing to a thin vertical bar that sprang
// open a moment later — and the unfitted marks, sized by width, laid out 0
// tall. With the attributes present the browser knows the ratio from the first
// layout and the mark is the right shape before a byte of it has arrived.
const MARKS: Record<
  SpinnerVariant,
  { src: string; width: number; height: number }
> = {
  flap: { src: flapUrl, width: 200, height: 157 },
  march: { src: marchUrl, width: 200, height: 48 },
  squadron: { src: squadronUrl, width: 520, height: 520 },
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
  /**
   * Scale the mark down to the box it is given rather than drawing it at its
   * natural size. Set this whenever the spinner is dropped into an area with a
   * height of its own — a fixed-aspect media stage, a tile — where the
   * `squadron` at full size would overflow and be clipped. Off by default: a
   * spinner that sits in ordinary page flow has all the room it needs.
   */
  fit?: boolean;
  className?: string;
}

// A branded loading indicator. The whole thing is a `role="status"` region so
// screen readers announce it; the animation itself is an `<img>` whose alt is
// empty (the caption carries the meaning) or falls back to "Loading".
export function Spinner({
  variant = "flap",
  label,
  fit = false,
  className,
}: SpinnerProps) {
  const classes = [
    styles.spinner,
    styles[variant],
    fit ? styles.fit : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const caption = label ?? (variant === "squadron" ? "Loading…" : undefined);
  const mark = MARKS[variant];
  return (
    <div className={classes} role="status" aria-live="polite">
      <img
        className={styles.art}
        src={mark.src}
        // The natural size, so the mark holds its shape before the SVG loads.
        // CSS sizes the mark on screen; these only state the ratio.
        width={mark.width}
        height={mark.height}
        alt={caption ? "" : "Loading"}
        draggable={false}
      />
      {caption ? <span className={styles.label}>{caption}</span> : null}
    </div>
  );
}
