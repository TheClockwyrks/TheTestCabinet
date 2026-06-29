import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { RunsPage } from "./RunsPage";
import { RunFailuresPage } from "./RunFailuresPage";
import { NewRunPage } from "./NewRunPage";
import { RunEventsPage } from "./[runId]/RunEventsPage";
import { RunMetadataPage } from "./[runId]/RunMetadataPage";
import { RunMetricsPage } from "./[runId]/RunMetricsPage";
import { RunMonitorPage } from "./[runId]/RunMonitorPage";
import { RunPlayPage } from "./[runId]/RunPlayPage";
import { RunProofPage } from "./[runId]/RunProofPage";
import { RunInputsPage } from "./[runId]/RunInputsPage";
import { RunVerdictPage } from "./[runId]/RunVerdictPage";
import { RunReviewPage } from "./[runId]/RunReviewPage";

// Routes owned by the runs section: the all-runs index list and the per-run
// detail, whose Verdict / Play / Inputs / Proof / Metrics / Events / Metadata
// tabs are each their own URL so a tab is linkable. The Verdict tab is the
// default at the bare run URL. Validation no longer has its own tab — it lives on
// the Metadata tab. The
// run-execution routes (new run, live monitor) are included only when the host
// can execute runs —
// they call the backend/worker contexts the static site does not provide.
// (`/runs/new` is a static path, so it outranks the `/runs/:runId` dynamic route
// regardless of order.) Returned as a fragment so the app's single <Routes>
// stitches every section's routes together.
export function runsRoutes(canExecute: boolean) {
  return (
    <>
      <Route path={routePatterns.runs} element={<RunsPage />} />
      {/* The publishable-failures worklist is console-only — it lists locally
          produced failures and publishes them, which the static site cannot do.
          Its static path outranks the `/runs/:runId` dynamic route. */}
      {canExecute && (
        <Route path={routePatterns.runFailures} element={<RunFailuresPage />} />
      )}
      {canExecute && (
        <Route path={routePatterns.runNew} element={<NewRunPage />} />
      )}
      {canExecute && (
        <Route path={routePatterns.runMonitor} element={<RunMonitorPage />} />
      )}
      <Route path={routePatterns.runDetail} element={<RunVerdictPage />} />
      <Route path={routePatterns.runReview} element={<RunReviewPage />} />
      <Route path={routePatterns.runInputs} element={<RunInputsPage />} />
      <Route path={routePatterns.runProof} element={<RunProofPage />} />
      <Route path={routePatterns.runPlay} element={<RunPlayPage />} />
      <Route path={routePatterns.runMetrics} element={<RunMetricsPage />} />
      <Route path={routePatterns.runEvents} element={<RunEventsPage />} />
      <Route path={routePatterns.runMetadata} element={<RunMetadataPage />} />
    </>
  );
}
