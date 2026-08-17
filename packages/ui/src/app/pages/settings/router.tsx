import { Navigate, Route } from "react-router";
import { routePatterns, routes } from "../../routes";
import { AppearancePage } from "./AppearancePage";
import { ConnectionsPage } from "./ConnectionsPage";
import { HarnessesPage } from "./HarnessesPage";
import { ReviewingPage } from "./ReviewingPage";

// Routes owned by the settings section: the Appearance, Connections, Harnesses, and
// Reviewing tabs, each its own URL so a tab is linkable, plus a bare `/settings` that
// redirects to Appearance (the first tab). Appearance is purely visual (sun +
// event-feed style) and works everywhere, so it — and the `/settings` redirect —
// mount on every host, including the static site. Connections drives the
// backend/worker contexts the static site does not provide, so it mounts only when
// the host can execute runs. Harnesses tunes per-harness settings — max parallelism
// (backend-backed, on any executing console) and, on the desktop app, the local
// cluster's harness credentials — so it mounts wherever either is possible.
// Reviewing edits the signed-in account's reviewing preferences (the review buffer
// every coverage plan and ladder inherits), which the backend holds, so it too
// mounts only on an executing console.
// Returned as a fragment so the app's single <Routes> stitches every section's
// routes together.
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
      {(canExecute || hasHarnessAuth) && (
        <Route
          path={routePatterns.settingsHarnesses}
          element={<HarnessesPage />}
        />
      )}
      {canExecute && (
        <Route
          path={routePatterns.settingsReviewing}
          element={<ReviewingPage />}
        />
      )}
    </>
  );
}
