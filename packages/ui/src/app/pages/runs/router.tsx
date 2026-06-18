import { Navigate, Route, useParams } from "react-router";
import { routePatterns, routes } from "../../routes";
import { RunsPage } from "./RunsPage";
import { NewRunPage } from "./NewRunPage";
import { RunEventsPage } from "./[runId]/RunEventsPage";
import { RunMetadataPage } from "./[runId]/RunMetadataPage";
import { RunMetricsPage } from "./[runId]/RunMetricsPage";
import { RunMonitorPage } from "./[runId]/RunMonitorPage";
import { RunPlayPage } from "./[runId]/RunPlayPage";
import { RunVerdictPage } from "./[runId]/RunVerdictPage";

// Routes owned by the runs section: the all-runs index list and the per-run
// detail, whose Verdict / Play / Metrics / Events / Metadata tabs are each their
// own URL so a tab is linkable. The Verdict tab is the default at the bare run
// URL. Validation no longer has its own tab — it lives on the Metadata tab — so
// the legacy `/validation` deep link redirects there. The run-execution routes
// (new run, live monitor) are included only when the host can execute runs —
// they call the backend/worker contexts the static site does not provide.
// (`/runs/new` is a static path, so it outranks the `/runs/:runId` dynamic route
// regardless of order.) Returned as a fragment so the app's single <Routes>
// stitches every section's routes together.
export function runsRoutes(canExecute: boolean) {
  return (
    <>
      <Route path={routePatterns.runs} element={<RunsPage />} />
      {canExecute && (
        <Route path={routePatterns.runNew} element={<NewRunPage />} />
      )}
      {canExecute && (
        <Route path={routePatterns.runMonitor} element={<RunMonitorPage />} />
      )}
      <Route path={routePatterns.runDetail} element={<RunVerdictPage />} />
      <Route path={routePatterns.runPlay} element={<RunPlayPage />} />
      <Route path={routePatterns.runMetrics} element={<RunMetricsPage />} />
      <Route path={routePatterns.runEvents} element={<RunEventsPage />} />
      <Route
        path={routePatterns.runValidation}
        element={<RedirectToMetadata />}
      />
      <Route path={routePatterns.runMetadata} element={<RunMetadataPage />} />
    </>
  );
}

// The Validation tab was folded into Metadata; preserve the old `/validation`
// deep link by redirecting it to the run's Metadata tab.
function RedirectToMetadata() {
  const { runId } = useParams<{ runId: string }>();
  return (
    <Navigate
      to={runId ? routes.runMetadata(runId) : routes.runs()}
      replace
    />
  );
}
