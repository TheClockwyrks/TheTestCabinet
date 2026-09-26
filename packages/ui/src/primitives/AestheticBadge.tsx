import { type AestheticRating, AESTHETIC_META } from "../ratings";
import styles from "./AestheticBadge.module.scss";

interface AestheticBadgeProps {
  rating: AestheticRating;
  className?: string;
}

// A run's reviewer-assigned AESTHETIC rating — the second rating channel of a
// validator-rated run — shown as a color-coded chip beside the functional
// {@link RatingBadge}. It renders with the same chrome so the pair reads as two
// verdicts of one run wherever they sit side by side (a run header, a run log
// row, a gallery card). The Legendary tier is exceptional and reserved, so its
// chip is distinct on sight: a slowly shimmering two-tone gradient (a static
// gradient under `prefers-reduced-motion`, still unlike any flat tier). The
// tier's full description is exposed as the title; the visible text names the
// channel so a lone badge is never mistaken for a functional rating.
export function AestheticBadge({ rating, className }: AestheticBadgeProps) {
  const meta = AESTHETIC_META[rating];
  return (
    <span
      className={`${styles.badge}${className ? ` ${className}` : ""}`}
      data-aesthetic={rating}
      title={`Aesthetic: ${meta.description}`}
      aria-label={`Aesthetic: ${meta.label}`}
    >
      {meta.label}
    </span>
  );
}
