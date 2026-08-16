import { useEffect } from "react";
import { useLocation } from "react-router";

// A tiny per-section memory of the last index/list URL the user actually viewed,
// so a detail page's back control returns to that exact tab (and search) rather
// than the section's default tab. A tabbed index page records its current URL as
// it renders; `BackChevron` reads the record for its section and uses it in place
// of the section-default fallback, degrading to that fallback on a fresh load or
// deep link (when nothing has been recorded this session).
//
// This is what makes "back" honour the tab you came from: the runs index, the
// test-case catalog, and the Other page (Game Jams / Tournaments) all split their
// contents across sibling routes (one per tab), so a fixed back target always
// dumped you on the default tab regardless of where you started. Recording the
// origin fixes every such section uniformly.
//
// A module-level map suffices for the single-page app: it need not survive a
// reload because returning from a detail page always follows an in-app visit to
// the list that repopulates it, and `BackChevron` falls back to the section
// default when the map is empty. It is read at render time (not click time),
// which is safe because the index page always renders — and records — before the
// detail page it links to.
//
// `coverage` is the odd one out and the reason `claimSectionReturn` exists below:
// a coverage plan's (or ladder's) dashboard is a list whose entries are *another*
// section's detail pages — its cells and its review queue link into `/runs/:runId`,
// whose back control declares itself part of `runs`. Per-section records alone
// therefore cannot express "return to the plan I came from", which is the whole
// review loop the coverage feature exists to serve: open a run, review it, back,
// repeat.
export type BackSection = "testCases" | "runs" | "other" | "coverage";

const lastIndexUrl = new Map<BackSection, string>();

// A cross-section return handed to the *next* detail page, set at click time by a
// list that links outside its own section (see `claimSectionReturn`). It outranks
// the per-section record because it is the more specific statement: the user is
// known to have arrived from here, rather than merely to have visited that section
// at some point. Any index page rendering clears it — that visit is a fresher, and
// unambiguous, statement of where "back" now means.
//
// The label travels with the URL because the detail page's own label describes its
// own section ("All runs"), which a claim has just made untrue: the control is the
// only thing a screen-reader user has to go on, so a chevron that goes to a coverage
// plan must say so.
let claimedReturn: { url: string; label: string | null } | null = null;

/** Resolve a section's back target: the last index URL seen, else `fallback`. */
export function sectionReturnTo(
  section: BackSection | undefined,
  fallback: string,
): string {
  // A claim applies only to a detail page that names a section. A page with no
  // section is one whose parent list is fixed (the plan dashboard's own "all plans"
  // chevron is the case in point), and honouring a claim there would let a page
  // link to itself.
  if (section && claimedReturn) return claimedReturn.url;
  if (!section) return fallback;
  return lastIndexUrl.get(section) ?? fallback;
}

/**
 * The label that goes with [`sectionReturnTo`]'s target: the claiming list's own
 * wording when a claim is in force, else `fallback`. Kept beside the URL resolver so
 * the two can never disagree about where the control leads.
 */
export function sectionReturnLabel(
  section: BackSection | undefined,
  fallback: string,
): string {
  if (section && claimedReturn?.label) return claimedReturn.label;
  return fallback;
}

/**
 * Hand `section`'s recorded index URL to the next detail page's back control,
 * whatever section that page belongs to. Call it from a link's `onClick` — at
 * click time, not render time, so it describes the route actually taken.
 *
 * This is what makes the coverage review loop close: a plan dashboard links to a
 * run, and that run's back control (which is part of the *runs* section) returns to
 * the plan rather than to the runs index. It is a no-op when the section has
 * recorded nothing, so a claim never invents a target.
 *
 * `label` is what the detail page's back control should call the destination, since
 * its own ("All runs") is now wrong. Omit it to keep the page's wording.
 */
export function claimSectionReturn(section: BackSection, label?: string): void {
  const url = lastIndexUrl.get(section);
  claimedReturn = url ? { url, label: label ?? null } : null;
}

/**
 * Record the current URL as `section`'s index/list location. Call from a tabbed
 * index page so a detail page reached from it can return to this exact tab.
 */
export function useRecordSectionIndex(section: BackSection): void {
  const { pathname, search } = useLocation();
  useEffect(() => {
    lastIndexUrl.set(section, `${pathname}${search}`);
    // Visiting any index supersedes an outstanding cross-section claim, including
    // the claim's own origin re-rendering as the user comes back to it — the loop
    // re-claims on the next link. Without this a claim would outlive the journey it
    // described and quietly redirect an unrelated detail page's back control.
    claimedReturn = null;
  }, [section, pathname, search]);
}
