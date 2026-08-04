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
  onBack,
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
  /**
   * Go back **within** the page instead of navigating: when set, the control is
   * a button that calls this, and `to` is ignored.
   *
   * For a page whose "parent" is a view of itself rather than another route —
   * the gg configuration editor, where an open agent's parent is the
   * configuration it belongs to. Such a page must not link to its own list,
   * because the step an operator wants back is the one they actually took.
   * A page that also has a route-level parent renders this only while an
   * in-page child is open.
   */
  onBack?: () => void;
}) {
  const target = sectionReturnTo(section, to);
  if (onBack) {
    return (
      <button
        type="button"
        className={styles.back}
        aria-label={label}
        title={label}
        onClick={onBack}
      >
        <span aria-hidden>&lsaquo;</span>
      </button>
    );
  }
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
