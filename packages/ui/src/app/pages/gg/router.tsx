import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { GgDashboardPage } from "./GgDashboardPage";
import { GgAggregatePage } from "./GgAggregatePage";
import { GgSessionsPage } from "./GgSessionsPage";

// The gg **analysis** section's routes: its own top-level `/gg` space, entered
// from the topbar's analyze control. The section opens on the cross-run dashboard,
// with the Kibana-style aggregate query surface and the recorded sessions beside
// it — each its own route so a tab is linkable and survives a reload. Console-only
// (the queries drive the worker's `POST /gg/aggregate`, which the static site
// cannot reach), so the caller mounts these only when the host `canExecute`.
// Returned as a fragment so the app's single <Routes> stitches every section's
// routes together.
export function ggAnalysisRoutes(canExecute: boolean) {
  if (!canExecute) return null;
  return (
    <>
      <Route path={routePatterns.ggAnalysis} element={<GgDashboardPage />} />
      <Route
        path={routePatterns.ggAnalysisAggregate}
        element={<GgAggregatePage />}
      />
      <Route
        path={routePatterns.ggAnalysisSessions}
        element={<GgSessionsPage />}
      />
    </>
  );
}
