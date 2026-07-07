import { type Rating, RATING_META } from "../ratings";
import styles from "./RatingBadge.module.scss";

interface RatingBadgeProps {
  rating: Rating;
  className?: string;
}

// A run's reviewer-assigned quality rating, shown as a color-coded chip. It's
// per-run context — a run log can sort by it, but the badge itself carries no
// aggregate or rank. The tier's full description is exposed as the title so the
// shorthand label stays legible inline.
export function RatingBadge({ rating, className }: RatingBadgeProps) {
  const meta = RATING_META[rating];
  return (
    <span
      className={`${styles.badge}${className ? ` ${className}` : ""}`}
      data-rating={rating}
      title={meta.description}
    >
      {meta.label}
    </span>
  );
}
