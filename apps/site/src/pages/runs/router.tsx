import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { RunsPage } from "./RunsPage";
import { RunMetadataPage } from "./[runId]/RunMetadataPage";
import { RunMetricsPage } from "./[runId]/RunMetricsPage";
import { RunPlayPage } from "./[runId]/RunPlayPage";
import { RunValidationPage } from "./[runId]/RunValidationPage";
import { RunVerdictPage } from "./[runId]/RunVerdictPage";

// Routes owned by the runs section: the all-runs index list and the per-run
// detail, whose Verdict / Play / Metrics / Validation / Metadata tabs are each
// their own URL so a tab is linkable. The Verdict tab is the default at the bare
// run URL. Returned as a fragment so the app's single <Routes> stitches every
// section's routes together.
export function runsRoutes() {
  return (
    <>
      <Route path={routePatterns.runs} element={<RunsPage />} />
      <Route path={routePatterns.runDetail} element={<RunVerdictPage />} />
      <Route path={routePatterns.runPlay} element={<RunPlayPage />} />
      <Route path={routePatterns.runMetrics} element={<RunMetricsPage />} />
      <Route
        path={routePatterns.runValidation}
        element={<RunValidationPage />}
      />
      <Route path={routePatterns.runMetadata} element={<RunMetadataPage />} />
    </>
  );
}
