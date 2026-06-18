import { Navigate, Route } from "react-router";
import { routePatterns, routes } from "../../routes";
import { AppearancePage } from "./AppearancePage";
import { ConnectionsPage } from "./ConnectionsPage";

// Routes owned by the settings section: the Appearance and Connections tabs,
// each its own URL so a tab is linkable, plus a bare `/settings` that redirects
// to Appearance (the first tab). Settings is console-only — the pages call the
// backend/worker contexts the static site does not provide — so the routes are
// included only when the host can execute runs. Returned as a fragment so the
// app's single <Routes> stitches every section's routes together.
export function settingsRoutes(canExecute: boolean) {
  if (!canExecute) return null;
  return (
    <>
      <Route
        path={routePatterns.settings}
        element={<Navigate to={routes.settingsAppearance()} replace />}
      />
      <Route
        path={routePatterns.settingsAppearance}
        element={<AppearancePage />}
      />
      <Route
        path={routePatterns.settingsConnections}
        element={<ConnectionsPage />}
      />
    </>
  );
}
