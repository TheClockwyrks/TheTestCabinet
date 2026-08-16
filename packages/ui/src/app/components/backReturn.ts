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
export type BackSection = "testCases" | "runs" | "other";

const lastIndexUrl = new Map<BackSection, string>();

/** Resolve a section's back target: the last index URL seen, else `fallback`. */
export function sectionReturnTo(
  section: BackSection | undefined,
  fallback: string,
): string {
  if (!section) return fallback;
  return lastIndexUrl.get(section) ?? fallback;
}

/**
 * Record the current URL as `section`'s index/list location. Call from a tabbed
 * index page so a detail page reached from it can return to this exact tab.
 */
export function useRecordSectionIndex(section: BackSection): void {
  const { pathname, search } = useLocation();
  useEffect(() => {
    lastIndexUrl.set(section, `${pathname}${search}`);
  }, [section, pathname, search]);
}
