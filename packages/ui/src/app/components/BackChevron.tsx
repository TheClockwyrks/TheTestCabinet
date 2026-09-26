import { Link } from "react-router";
import {
  sectionReturnLabel,
  sectionReturnTo,
  type BackSection,
} from "./backReturn";
import styles from "./BackChevron.module.scss";

/**
 * What the chevron does when pressed, as a choice the caller must make: it is
 * either a link to the parent route, or a button that hands the step back to the
 * page. Modelled as a union rather than as two optional props so the unused half
 * cannot be passed — a `to` beside an `onBack` would name a route the control
 * never navigates to, which is exactly the kind of quiet lie a reader trusts.
 */
type BackChevronTarget =
  | {
      /**
       * The parent list route to return to. When `section` is given and the user
       * has visited a tab in that section this session, that remembered tab wins
       * over this route; otherwise this is the fallback (e.g. a fresh deep link).
       */
      to: string;
      /**
       * The tabbed section this detail belongs to. Set it so back returns to the
       * tab the user came from (see `backReturn`) instead of the section default.
       * Omit for a parent list with no tabs.
       */
      section?: BackSection;
      onBack?: never;
    }
  | {
      /**
       * Take the step back **here** instead of navigating: the control is then a
       * button that calls this.
       *
       * For a page whose "parent" is a view of itself rather than another route —
       * the gg configuration editor, where an open agent's parent is the
       * configuration it belongs to. Such a page must not link to its own list,
       * because the step an operator wants back is the one they actually took.
       *
       * Also for a page that must *ask* before leaving: a page holding unsaved
       * work raises its own dialog from here and navigates once that dialog is
       * answered. A confirmation cannot be a property of the link, because the
       * answer arrives long after the click a link would have to allow or cancel
       * on the spot.
       */
      onBack: () => void;
      to?: never;
      section?: never;
    };

// A quiet "back" affordance sat to the left of a detail-page title: a single
// left-chevron linking to the parent list (all test cases, all runs, all models,
// a reviewer's plans/groups). Icon-only but labelled for assistive tech, so it
// reads as an unobtrusive return arrow beside the title rather than competing
// with it. Every detail page uses the same control so they read as one family.
export function BackChevron(
  props: BackChevronTarget & {
    /**
     * Accessible label / tooltip for the icon-only control. A cross-section claim
     * (see `backReturn`) supplies its own, because such a claim has redirected the
     * control somewhere this page's wording does not describe.
     */
    label?: string;
  },
) {
  const label = props.label ?? "Back";
  if (props.onBack) {
    // A page taking the step itself has no section, so there is no claim that could
    // have moved the destination out from under this label: what the caller said is
    // what happens.
    return (
      <button
        type="button"
        className={styles.back}
        aria-label={label}
        title={label}
        onClick={props.onBack}
      >
        <span aria-hidden>&lsaquo;</span>
      </button>
    );
  }
  const announced = sectionReturnLabel(props.section, label);
  return (
    <Link
      className={styles.back}
      to={sectionReturnTo(props.section, props.to)}
      aria-label={announced}
      title={announced}
    >
      <span aria-hidden>&lsaquo;</span>
    </Link>
  );
}
