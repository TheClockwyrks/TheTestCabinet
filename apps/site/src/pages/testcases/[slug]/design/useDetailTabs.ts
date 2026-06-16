import { useLocation } from "react-router";
import { routes } from "../../../../routes";
import type { DetailTab } from "./types";

// One resolved tab link for a design shell to render.
export interface DetailTabLink {
  key: DetailTab;
  label: string;
  /** Target carrying the current query string so the selected variant survives
   * a tab switch. */
  to: { pathname: string; search: string };
  active: boolean;
}

// The three detail tabs, resolved against the case slug and the active tab. Every
// design shell builds its nav from this so the tab set, labels, and
// variant-preserving links stay defined in exactly one place regardless of how a
// shell lays them out.
export function useDetailTabs(slug: string, active: DetailTab): DetailTabLink[] {
  const { search } = useLocation();
  return [
    {
      key: "overview",
      label: "Overview",
      to: { pathname: routes.testCaseDetail(slug), search },
      active: active === "overview",
    },
    {
      key: "specs",
      label: "Specifications",
      to: { pathname: routes.testCaseSpecs(slug), search },
      active: active === "specs",
    },
    {
      key: "runs",
      label: "Runs",
      to: { pathname: routes.testCaseRuns(slug), search },
      active: active === "runs",
    },
  ];
}
