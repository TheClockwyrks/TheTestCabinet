import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { GgDashboardViewPage } from "./GgDashboardViewPage";
import { GgDashboardsPage } from "./GgDashboardsPage";
import { GgDiscoverPage } from "./GgDiscoverPage";
import { GgSavedQueriesPage } from "./GgSavedQueriesPage";
import { GgSessionsPage } from "./GgSessionsPage";
import { GgLegacyRedirect } from "./discover/GgLegacyRedirect";

// The gg **analysis** section's routes: its own top-level `/gg` space, entered from
// the topbar's analyze control. Console-only — the section reads the worker's
// recorded gg runs, which the static site does not carry — so the caller mounts
// these only when the host `canExecute`. Returned as a fragment so the app's single
// <Routes> stitches every section's routes together.
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
export function ggAnalysisRoutes(canExecute: boolean) {
  if (!canExecute) return null;
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
