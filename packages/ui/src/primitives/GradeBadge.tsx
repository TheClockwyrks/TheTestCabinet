import { type GradeStatus, GRADE_META } from "../ratings";
import styles from "./GradeBadge.module.scss";

interface GradeBadgeProps {
  status: GradeStatus;
  className?: string;
}

// A game jam's whole-game overall grade (or a category grade), shown as a
// color-coded chip — the graded analogue of {@link RatingBadge}, which a jam has
// in place of a per-domain rating. It deliberately renders exactly like a rating
// badge (label only, tinted by tier) so a jam's badge reads as the same thing as
// a regular run's wherever the two sit side by side — a run log row, a run's
// verdict header, a leaderboard. The tier emoji belongs to the *input* scale (the
// reviewer's grade buttons and the per-category checklist rows), not to this
// badge; the tier's point value is exposed as the title.
export function GradeBadge({ status, className }: GradeBadgeProps) {
  const meta = GRADE_META[status];
  return (
    <span
      className={`${styles.badge}${className ? ` ${className}` : ""}`}
      data-grade={status}
      title={`${meta.label} — ${meta.points} ${meta.points === 1 ? "pt" : "pts"}`}
    >
      {meta.label}
    </span>
  );
}
