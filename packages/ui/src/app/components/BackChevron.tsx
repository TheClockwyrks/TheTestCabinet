import type { ReactNode } from "react";
import { Link } from "react-router";
import { useBackTarget, type BackScope } from "./navHistory";
import styles from "./BackChevron.module.scss";

/** The label a back control carries when it returns through history. */
const HISTORY_LABEL = "Back";

/**
 * What the chevron does when pressed, as a choice the caller must make: it is
 * either a link back to the previous page, or a button that hands the step back to
 * the page. Modelled as a union rather than as two optional props so the unused half
 * cannot be passed.
 */
type BackChevronTarget =
  | {
      /**
       * The path of the page this chevron leaves: the route its tabs and sub-views
       * all live under (a run's `/runs/:runId`, a case's `/test-cases/:slug`). Back
       * returns to the most recent page outside it, so moving between the page's own
       * tabs never becomes a step back.
       */
      scope: BackScope;
      /**
       * Where back leads when there is no in-app history behind the page (a fresh
       * deep link): the parent list the page belongs to.
       */
      fallback: string;
      onBack?: never;
    }
  | {
      /**
       * Take the step back **here** instead of linking: the control is then a button
       * that calls this.
       *
       * For a page whose "parent" is a view of itself rather than another route —
       * the gg configuration editor, where an open agent's parent is the
       * configuration it belongs to.
       *
       * Also for a page that must *ask* before leaving: a page holding unsaved work
       * raises its own dialog from here and navigates once that dialog is answered
       * (with [`useBackTarget`]'s `go`, so it still returns to the previous page). A
       * confirmation cannot be a property of the link, because the answer arrives
       * long after the click a link would have to allow or cancel on the spot.
       */
      onBack: () => void;
      scope?: never;
      fallback?: never;
    };

// A quiet "back" affordance sat to the left of a detail-page title: a single
// left-chevron returning to the page the viewer came from. Icon-only but labelled
// for assistive tech, so it reads as an unobtrusive return arrow beside the title
// rather than competing with it. Every detail page uses the same control so they
// read as one family.
export function BackChevron(
  props: BackChevronTarget & {
    /**
     * Accessible label / tooltip naming the fallback destination ("All runs"). When
     * the control returns through history it is labelled "Back" instead, since the
     * destination is wherever the viewer came from. A button (`onBack`) always
     * carries this label: what the caller said is what happens.
     */
    label?: string;
  },
) {
  if (props.onBack) {
    const label = props.label ?? HISTORY_LABEL;
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
  return (
    <BackChevronLink
      scope={props.scope}
      fallback={props.fallback}
      label={props.label}
    />
  );
}

function BackChevronLink({
  scope,
  fallback,
  label,
}: {
  scope: BackScope;
  fallback: string;
  label?: string;
}) {
  const back = useBackTarget(scope, fallback);
  const announced = back.fromHistory ? HISTORY_LABEL : (label ?? HISTORY_LABEL);
  return (
    <Link
      className={styles.back}
      to={back.href}
      onClick={back.onClick}
      aria-label={announced}
      title={announced}
    >
      <span aria-hidden>&lsaquo;</span>
    </Link>
  );
}

/**
 * A text back link ("← All reviews"): the same behaviour as the chevron, for a page
 * that leads back in words. Its text names the fallback destination, and reads
 * "Back" when it returns through history to wherever the viewer came from.
 */
export function BackLink({
  scope,
  fallback,
  children,
  className,
}: {
  scope: BackScope;
  fallback: string;
  /** The fallback destination's name, shown after the arrow. */
  children: ReactNode;
  className?: string;
}) {
  const back = useBackTarget(scope, fallback);
  return (
    <Link className={className} to={back.href} onClick={back.onClick}>
      &larr; {back.fromHistory ? HISTORY_LABEL : children}
    </Link>
  );
}
