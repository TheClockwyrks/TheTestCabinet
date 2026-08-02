import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { GgDashboardViewPage } from "./GgDashboardViewPage";
import { GgDashboardsPage } from "./GgDashboardsPage";
import { GgDiscoverPage } from "./GgDiscoverPage";
import { GgSavedQueriesPage } from "./GgSavedQueriesPage";
import { GgSessionsPage } from "./GgSessionsPage";
import { GgLegacyRedirect } from "./discover/GgLegacyRedirect";

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
// The two `/gg/aggregate*` routes are the **legacy** aggregate surface's addresses. The
// widget builder behind them is gone, but the best property of that implementation was
// that the URL *was* the query, and those URLs were pasted into issues and notes — so
// they transcode to equivalent TCQ text and redirect into Discover rather than 404.
export function ggAnalysisRoutes(canExecute: boolean, hasGgData = false) {
  if (!canExecute) {
    if (!hasGgData) return null;
    // Discover, plus the legacy aggregate addresses — those transcode into Discover, so
    // they resolve here for the same reason they do on a console.
    return (
      <>
        <Route
          path={routePatterns.ggAnalysisDiscover}
          element={<GgDiscoverPage />}
        />
        <Route
          path={routePatterns.ggAnalysisAggregateLegacy}
          element={<GgLegacyRedirect />}
        />
        <Route
          path={routePatterns.ggAnalysisAggregateResultsLegacy}
          element={<GgLegacyRedirect />}
        />
      </>
    );
  }
  return (
    <>
      <Route path={routePatterns.ggAnalysis} element={<GgSessionsPage />} />
      <Route path={routePatterns.ggAnalysisDiscover} element={<GgDiscoverPage />} />
      <Route
        path={routePatterns.ggAnalysisDashboards}
        element={<GgDashboardsPage />}
      />
      <Route
        path={routePatterns.ggAnalysisDashboard}
        element={<GgDashboardViewPage />}
      />
      <Route path={routePatterns.ggAnalysisSaved} element={<GgSavedQueriesPage />} />
      <Route
        path={routePatterns.ggAnalysisAggregateLegacy}
        element={<GgLegacyRedirect />}
      />
      <Route
        path={routePatterns.ggAnalysisAggregateResultsLegacy}
        element={<GgLegacyRedirect />}
      />
    </>
  );
}
