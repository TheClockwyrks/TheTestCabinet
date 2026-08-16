import { Link } from "react-router";
import {
  sectionReturnLabel,
  sectionReturnTo,
  type BackSection,
} from "./backReturn";
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
}: {
  /**
   * The parent list route to return to. When `section` is given and the user
   * has visited a tab in that section this session, that remembered tab wins
   * over this route; otherwise this is the fallback (e.g. a fresh deep link).
   */
  to: string;
  /**
   * Accessible label / tooltip for the icon-only link. A cross-section claim (see
   * `backReturn`) supplies its own, because such a claim has redirected the control
   * somewhere this page's wording does not describe.
   */
  label?: string;
  /**
   * The tabbed section this detail belongs to. Set it so back returns to the
   * tab the user came from (see `backReturn`) instead of the section default.
   * Omit for a parent list with no tabs.
   */
  section?: BackSection;
}) {
  const target = sectionReturnTo(section, to);
  const announced = sectionReturnLabel(section, label);
  return (
    <Link
      className={styles.back}
      to={target}
      aria-label={announced}
      title={announced}
    >
      <span aria-hidden>&lsaquo;</span>
    </Link>
  );
}
