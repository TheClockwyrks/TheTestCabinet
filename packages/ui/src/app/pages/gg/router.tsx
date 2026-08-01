import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { GgSessionsPage } from "./GgSessionsPage";

// The gg **analysis** section's routes: its own top-level `/gg` space, entered from
// the topbar's analyze control. Console-only — the section reads the worker's
// recorded gg runs, which the static site does not carry — so the caller mounts
// these only when the host `canExecute`. Returned as a fragment so the app's single
// <Routes> stitches every section's routes together.
//
// One route today. The widget-builder aggregate surface was removed along with the
// closed facet/metric vocabulary it was built on; the query language replacing it
// adds its Discover, Dashboards and Saved routes here.
export function ggAnalysisRoutes(canExecute: boolean) {
  if (!canExecute) return null;
  return <Route path={routePatterns.ggAnalysis} element={<GgSessionsPage />} />;
}
