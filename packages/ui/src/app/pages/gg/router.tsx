import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { GgDiscoverPage } from "./GgDiscoverPage";
import { GgSessionsPage } from "./GgSessionsPage";
import { GgLegacyRedirect } from "./discover/GgLegacyRedirect";

// The gg **analysis** section's routes: its own top-level `/gg` space, entered from
// the topbar's analyze control. Console-only — the section reads the worker's
// recorded gg runs, which the static site does not carry — so the caller mounts
// these only when the host `canExecute`. Returned as a fragment so the app's single
// <Routes> stitches every section's routes together.
//
// The index is the recorded sessions; `/gg/query` is Discover, the TCQ surface.
// Dashboards and Saved mount here when they land.
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
