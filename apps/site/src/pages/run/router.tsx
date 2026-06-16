import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { RunMetadataPage } from "./[runId]/RunMetadataPage";
import { RunMetricsPage } from "./[runId]/RunMetricsPage";
import { RunPlayPage } from "./[runId]/RunPlayPage";
import { RunVerdictPage } from "./[runId]/RunVerdictPage";

// Routes owned by the run detail page subtree, whose Verdict / Play / Metrics /
// Metadata tabs are each their own URL so a tab is linkable. The Verdict tab is
// the default at the bare run URL. Returned as a fragment so the app's single
// <Routes> stitches every section's routes together.
export function runRoutes() {
  return (
    <>
      <Route path={routePatterns.runDetail} element={<RunVerdictPage />} />
      <Route path={routePatterns.runPlay} element={<RunPlayPage />} />
      <Route path={routePatterns.runMetrics} element={<RunMetricsPage />} />
      <Route path={routePatterns.runMetadata} element={<RunMetadataPage />} />
    </>
  );
}
