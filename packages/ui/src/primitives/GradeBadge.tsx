import { type GradeStatus, GRADE_META } from "../ratings";
import styles from "./GradeBadge.module.scss";

interface GradeBadgeProps {
  status: GradeStatus;
  className?: string;
}

// A game jam's whole-game overall grade (or a category grade), shown as a
// color-coded chip pairing the tier's emoji with its label — the graded analogue
// of {@link RatingBadge}, which a jam has in place of a per-domain rating. The
// tier color comes from the `data-grade` attribute so the markup stays a single
// element; the point value is exposed as the title.
export function GradeBadge({ status, className }: GradeBadgeProps) {
  const meta = GRADE_META[status];
  return (
    <span
      className={`${styles.badge}${className ? ` ${className}` : ""}`}
      data-grade={status}
      title={`${meta.label} — ${meta.points} ${meta.points === 1 ? "pt" : "pts"}`}
    >
      <span className={styles.emoji} aria-hidden="true">
        {meta.emoji}
      </span>
      {meta.label}
    </span>
  );
}
