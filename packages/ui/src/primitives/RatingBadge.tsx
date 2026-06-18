import { type Rating, RATING_META } from "../ratings";
import styles from "./RatingBadge.module.scss";

interface RatingBadgeProps {
  rating: Rating;
  className?: string;
}

// A run's reviewer-assigned quality rating, shown as a color-coded chip. This is
// per-run context, never a ranking: the gallery never sorts or aggregates by it.
// The tier's full description is exposed as the title so the shorthand label
// stays legible inline.
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
