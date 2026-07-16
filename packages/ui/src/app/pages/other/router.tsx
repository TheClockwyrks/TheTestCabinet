import { Navigate, Route } from "react-router";
import { routePatterns, routes } from "../../routes";
import { OtherPage } from "./OtherPage";
import { TournamentDetailPage } from "../tournaments/TournamentDetailPage";
import { JamOverviewPage } from "../gamejams/[slug]/JamOverviewPage";
import { JamInputsPage } from "../gamejams/[slug]/JamInputsPage";
import { JamRunsPage } from "../gamejams/[slug]/JamRunsPage";
import { JamLeaderboardPage } from "../gamejams/[slug]/JamLeaderboardPage";
import { JamMetricsPage } from "../gamejams/[slug]/JamMetricsPage";

// Routes owned by the "Other" section: the tabbed list page (Game Jams +
// Tournaments), the game-jam detail with its reduced tab set, and the tournament
// detail (the standalone Tournaments list moved under Other, but each tournament
// keeps its own detail route). Every surface here reads through console-only data
// (the catalog on a console, plus the arena capability for tournaments), so the
// whole fragment is mounted only where the host can execute; the static site never
// routes here. Returned as a fragment so the app's single <Routes> stitches every
// section's routes together.
export function otherRoutes(canExecute: boolean) {
  if (!canExecute) return null;
  return (
    <>
      {/* The bare section path lands on the first tab (Game Jams). */}
      <Route
        path={routePatterns.other}
        element={<Navigate to={routes.otherGameJams()} replace />}
      />
      <Route
        path={routePatterns.otherGameJams}
        element={<OtherPage tab="game-jams" />}
      />
      <Route
        path={routePatterns.otherTournaments}
        element={<OtherPage tab="tournaments" />}
      />

      {/* Game-jam detail: Overview / Inputs / Runs / Leaderboard / Metrics, each
          its own URL so a tab (and the variant carried in the query string) is
          linkable — mirroring the test-case detail routes, minus the tabs a jam
          has no data for. */}
      <Route path={routePatterns.gameJamDetail} element={<JamOverviewPage />} />
      <Route path={routePatterns.gameJamInputs} element={<JamInputsPage />} />
      <Route path={routePatterns.gameJamRuns} element={<JamRunsPage />} />
      <Route
        path={routePatterns.gameJamLeaderboard}
        element={<JamLeaderboardPage />}
      />
      <Route path={routePatterns.gameJamMetrics} element={<JamMetricsPage />} />

      {/* The tournament detail keeps its existing `/tournaments/:id` route; its
          list now lives under Other → Tournaments. */}
      <Route
        path={routePatterns.tournamentDetail}
        element={<TournamentDetailPage />}
      />
    </>
  );
}
