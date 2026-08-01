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
export const GG_CHROME: TopbarChrome = {
  home: routes.runs(),
  label: "gg analysis",
  back: true,
  links: [
    { label: "Sessions", to: routes.ggAnalysis(), end: true },
    { label: "Discover", to: routes.ggAnalysisDiscover() },
  ],
};
