import { Route } from "react-router";
import { routePatterns } from "../../../routes";
import { GgRunMonitorPage } from "./GgRunMonitorPage";

// The gg run-execution route: the live gg run monitor (`/runs/gg/:jobId/live`). A gg
// run is *configured* in the account section (its named capability sets) and
// *launched* from the ordinary new-run form (picking `gg` as the orchestrator), so
// there is no gg launch route here; the cross-run analysis surfaces are their own
// `/gg` section. It is console-only — it drives the backend/worker contexts the
// static site does not provide — so the caller includes it only when the host
// `canExecute`. Its literal `/runs/gg` prefix outranks the `/runs/:runId` dynamic
// route, so ordering does not matter. Returned as a fragment so `runsRoutes` can
// stitch it into the runs section's routes alongside the conventional monitor
// pages.
export function ggRoutes(canExecute: boolean) {
  if (!canExecute) return null;
  return (
    <>
      <Route path={routePatterns.ggMonitor} element={<GgRunMonitorPage />} />
    </>
  );
}
