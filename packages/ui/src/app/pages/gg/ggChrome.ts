import type { TopbarChrome } from "../../components/PageLayout";
import { routes } from "../../routes";

// The gg analysis section's topbar chrome.
//
// Analysis is a *mode*, not another section of the app: entered from the topbar's
// analyze control, it keeps the same bar, controls, and page frame — so nothing
// about the console's look shifts under the operator — but replaces the app's
// identity and section nav with gg's own. The mark becomes a back arrow that leads
// out of the mode (there is no "gg home" to go to), and the section links become
// the analysis tabs.

/** The console's chrome: every tab, because a console has a backend behind all of them. */
export const GG_CHROME: TopbarChrome = {
  home: routes.runs(),
  label: "gg analysis",
  back: true,
  links: [
    { label: "Sessions", to: routes.ggAnalysis(), end: true },
    { label: "Dashboards", to: routes.ggAnalysisDashboards() },
    { label: "Discover", to: routes.ggAnalysisDiscover() },
    { label: "Saved", to: routes.ggAnalysisSaved() },
    // Reference is not an analysis surface — it answers "what can gg's models
    // actually do" rather than "what did they do" — but it belongs behind the same
    // chrome, because it is the document every other tab's findings are read
    // against: a session that never called `compact` reads differently once you
    // have seen what `compact` is offered as. It sits last, after the four
    // question-asking tabs.
    { label: "Reference", to: routes.ggReference() },
  ],
};

/**
 * The public static site's chrome: **Discover alone**.
 *
 * The other four tabs are not hidden out of caution, they are genuinely absent. Saved
 * queries and dashboards are per-account objects and the site mounts no accounts; the
 * Sessions tab is the run listing narrowed to gg, and the site's run listing holds only
 * *published* runs while the exported corpus deliberately holds every recorded one — so
 * it would show a shorter list beside a query counting a longer one, which reads as a
 * bug. Reference is served by a backend (`GET /gg/reference`) and the site has none
 * behind it — and a bundled copy would be worse than its absence, since it would
 * describe whichever gg the *site* was built from rather than the one that ran anything.
 * A nav link to a route the app does not mount is worse than one fewer link.
 */
export const GG_PUBLIC_CHROME: TopbarChrome = {
  home: routes.home(),
  label: "gg analysis",
  back: true,
  links: [{ label: "Discover", to: routes.ggAnalysisDiscover(), end: true }],
};

/** The chrome for a host, by whether it has a live backend behind the section. */
export function ggChrome(live: boolean): TopbarChrome {
  return live ? GG_CHROME : GG_PUBLIC_CHROME;
}
