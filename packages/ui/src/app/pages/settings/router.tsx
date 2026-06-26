import { Navigate, Route } from "react-router";
import { routePatterns, routes } from "../../routes";
import { AppearancePage } from "./AppearancePage";
import { ConnectionsPage } from "./ConnectionsPage";
import { HarnessAuthPage } from "./HarnessAuthPage";

// Routes owned by the settings section: the Appearance, Connections, and
// Authentication tabs, each its own URL so a tab is linkable, plus a bare
// `/settings` that redirects to Appearance (the first tab). Appearance is purely
// visual (sun + event-feed style) and works everywhere, so it — and the
// `/settings` redirect — mount on every host, including the static site.
// Connections drives the backend/worker contexts the static site does not
// provide, so it mounts only when the host can execute runs. Authentication
// manages the local cluster's harness credentials, so it mounts only on a host
// that supplies the harness-auth capability (the desktop app). Returned as a
// fragment so the app's single <Routes> stitches every section's routes together.
export function settingsRoutes(canExecute: boolean, hasHarnessAuth: boolean) {
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
      {canExecute && (
        <Route
          path={routePatterns.settingsConnections}
          element={<ConnectionsPage />}
        />
      )}
      {hasHarnessAuth && (
        <Route
          path={routePatterns.settingsAuth}
          element={<HarnessAuthPage />}
        />
      )}
    </>
  );
}
