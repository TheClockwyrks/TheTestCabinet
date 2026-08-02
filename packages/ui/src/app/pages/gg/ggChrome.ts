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
  ],
};

/**
 * The public static site's chrome: **Discover alone**.
 *
 * The other three tabs are not hidden out of caution, they are genuinely absent. Saved
 * queries and dashboards are per-account objects and the site mounts no accounts; the
 * Sessions tab is the run listing narrowed to gg, and the site's run listing holds only
 * *published* runs while the exported corpus deliberately holds every recorded one — so
 * it would show a shorter list beside a query counting a longer one, which reads as a
 * bug. A nav link to a route the app does not mount is worse than one fewer link.
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
