import { Route } from "react-router";
import { routePatterns } from "../../../routes";
import { NewGgRunPage } from "./NewGgRunPage";
import { GgAnalyzePage } from "./GgAnalyzePage";
import { GgRunMonitorPage } from "./GgRunMonitorPage";

// The gg run-execution routes: the capability-set config page (`/runs/gg/new`) and
// the live gg run monitor (`/runs/gg/:jobId/live`). Both are console-only — they
// drive the backend/worker contexts the static site does not provide — so the
// caller includes them only when the host `canExecute`. Their literal `/runs/gg`
// prefix outranks the `/runs/:runId` dynamic route, so ordering does not matter.
// Returned as a fragment so `runsRoutes` can stitch them into the runs section's
// routes alongside the conventional new-run/monitor pages.
export function ggRoutes(canExecute: boolean) {
  if (!canExecute) return null;
  return (
    <>
      <Route path={routePatterns.ggNew} element={<NewGgRunPage />} />
      <Route path={routePatterns.ggAnalyze} element={<GgAnalyzePage />} />
      <Route path={routePatterns.ggMonitor} element={<GgRunMonitorPage />} />
    </>
  );
}
