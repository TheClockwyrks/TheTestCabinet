import { type Rating, RATING_META } from "../ratings";
import styles from "./RatingBadge.module.scss";

interface RatingBadgeProps {
  rating: Rating;
  className?: string;
  /** Replaces the tier's description as the hover text, for a badge that stands
   * for something other than a run's rating (a review item's failure cap). */
  title?: string;
  /** Dims the chip: the tier is named but is not in force — a failure cap on
   * an item that did not fail. The label still reads the tier, but the chip
   * reads as disabled rather than as a plainer badge. */
  muted?: boolean;
}

// A run's reviewer-assigned quality rating, shown as a color-coded chip. It's
// per-run context — a run log can sort by it, but the badge itself carries no
// aggregate or rank. The tier's full description is exposed as the title so the
// shorthand label stays legible inline.
export function RatingBadge({
  rating,
  className,
  title,
  muted = false,
}: RatingBadgeProps) {
  const meta = RATING_META[rating];
  return (
    <span
      className={`${styles.badge}${className ? ` ${className}` : ""}`}
      data-rating={rating}
      data-muted={muted ? "true" : undefined}
      title={title ?? meta.description}
    >
      {meta.label}
    </span>
  );
}
