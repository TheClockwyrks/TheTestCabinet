import { Navigate, Route } from "react-router";
import { routePatterns, routes } from "../../routes";
import { GgDashboardViewPage } from "./GgDashboardViewPage";
import { GgDashboardsPage } from "./GgDashboardsPage";
import { GgDiscoverPage } from "./GgDiscoverPage";
import { GgSavedQueriesPage } from "./GgSavedQueriesPage";
import { GgSessionsPage } from "./GgSessionsPage";
import { GgReferencePage } from "./reference/GgReferencePage";

// The gg **analysis** section's routes: its own top-level `/gg` space, entered from
// the topbar's analyze control. Returned as a fragment so the app's single <Routes>
// stitches every section's routes together.
//
// Two shapes, because there are two hosts. A **console** (`canExecute`) mounts the whole
// section against its backend. The **public static site** mounts Discover alone, against
// the gg document corpus shipped in the published snapshot — the surface is genuinely
// smaller there rather than merely restricted: Sessions is the run listing (the site has
// only published runs, while the corpus deliberately has every recorded one), and saved
// queries and dashboards are per-account objects on a host with no accounts. A host with
// neither mounts nothing.
//
// The index is the recorded sessions; `/gg/query` is Discover, the TCQ surface;
// `/gg/dashboards` is the boards list with `/gg/dashboards/:dashboardId` rendering one
// (the built-in overview answers to the reserved `overview` id, resolved from code rather
// than from the store); `/gg/saved` is the operator's saved queries. The static
// `/gg/dashboards` outranks nothing it could collide with — its only sibling under that
// prefix is its own `:dashboardId` child.
//
// `/gg/reference` is the **Reference** surface — gg's tools and responses-as-code API
// as models are shown them. Console-only, and not because it is sensitive: it is served
// by a backend (`GET /gg/reference`), and the static site has none behind it. Its two
// tabs are their own URLs, with the bare path redirecting to Tools the way the test-case
// catalog's bare path redirects to its default tab — and, like that catalog, both tab
// URLs mount the *same* component with a different `tab`, which is what keeps one fetch
// across a tab switch.
export function ggAnalysisRoutes(canExecute: boolean, hasGgData = false) {
  if (!canExecute) {
    if (!hasGgData) return null;
    return (
      <Route
        path={routePatterns.ggAnalysisDiscover}
        element={<GgDiscoverPage />}
      />
    );
  }
  return (
    <>
      <Route path={routePatterns.ggAnalysis} element={<GgSessionsPage />} />
      <Route
        path={routePatterns.ggAnalysisDiscover}
        element={<GgDiscoverPage />}
      />
      <Route
        path={routePatterns.ggAnalysisDashboards}
        element={<GgDashboardsPage />}
      />
      <Route
        path={routePatterns.ggAnalysisDashboard}
        element={<GgDashboardViewPage />}
      />
      <Route
        path={routePatterns.ggAnalysisSaved}
        element={<GgSavedQueriesPage />}
      />
      <Route
        path={routePatterns.ggReference}
        element={<Navigate to={routes.ggReferenceTools()} replace />}
      />
      {/* One component against both patterns, not two — see `GgReferencePage`: it owns
          the fetch both tabs read from, and only a shared component type survives the
          switch without React unmounting the subtree and re-requesting the document. */}
      <Route
        path={routePatterns.ggReferenceTools}
        element={<GgReferencePage tab="tools" />}
      />
      <Route
        path={routePatterns.ggReferenceApi}
        element={<GgReferencePage tab="api" />}
      />
    </>
  );
}
