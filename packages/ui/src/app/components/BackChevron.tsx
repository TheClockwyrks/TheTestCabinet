import { Link } from "react-router";
import { sectionReturnTo, type BackSection } from "./backReturn";
import styles from "./BackChevron.module.scss";

// A quiet "back" affordance sat to the left of a detail-page title: a single
// left-chevron linking to the parent list (all test cases, all runs, all models,
// a reviewer's plans/groups). Icon-only but labelled for assistive tech, so it
// reads as an unobtrusive return arrow beside the title rather than competing
// with it. Every detail page uses the same control so they read as one family.
export function BackChevron({
  to,
  label = "Back",
  section,
  guard,
}: {
  /**
   * The parent list route to return to. When `section` is given and the user
   * has visited a tab in that section this session, that remembered tab wins
   * over this route; otherwise this is the fallback (e.g. a fresh deep link).
   */
  to: string;
  /** Accessible label / tooltip for the icon-only link. */
  label?: string;
  /**
   * The tabbed section this detail belongs to. Set it so back returns to the
   * tab the user came from (see `backReturn`) instead of the section default.
   * Omit for a parent list with no tabs.
   */
  section?: BackSection;
  /**
   * Asked before leaving; returning `false` cancels the navigation. Set it on a
   * detail page that can hold unsaved work, so going back can confirm first
   * instead of discarding it silently. Omit on a read-only detail.
   */
  guard?: () => boolean;
}) {
  const target = sectionReturnTo(section, to);
  return (
    <Link
      className={styles.back}
      to={target}
      aria-label={label}
      title={label}
      onClick={(e) => {
        if (guard && !guard()) e.preventDefault();
      }}
    >
      <span aria-hidden>&lsaquo;</span>
    </Link>
  );
}
