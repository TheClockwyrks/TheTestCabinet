import { Link } from "react-router";
import styles from "./BackChevron.module.scss";

// A quiet "back" affordance sat to the left of a detail-page title: a single
// left-chevron linking to the parent list (all test cases, all runs, all models,
// a reviewer's plans/groups). Icon-only but labelled for assistive tech, so it
// reads as an unobtrusive return arrow beside the title rather than competing
// with it. Every detail page uses the same control so they read as one family.
export function BackChevron({
  to,
  label = "Back",
}: {
  /** The parent list route to return to. */
  to: string;
  /** Accessible label / tooltip for the icon-only link. */
  label?: string;
}) {
  return (
    <Link className={styles.back} to={to} aria-label={label} title={label}>
      <span aria-hidden>&lsaquo;</span>
    </Link>
  );
}
