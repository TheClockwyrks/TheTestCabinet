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
// keeps its own detail route).
//
// The game-jam surfaces read through the catalog and the published run summaries,
// which every host has — the static site included, where a jam's runs are
// published like any other — so they mount unconditionally. Tournaments read
// through the arena capability, which only a console carries, so that tab and the
// tournament detail stay behind `canExecute`; the section's tab bar hides the tab
// on a host that never routes there.
//
// Returned as a fragment so the app's single <Routes> stitches every section's
// routes together.
export function otherRoutes(canExecute: boolean) {
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

      {canExecute && (
        <>
          <Route
            path={routePatterns.otherTournaments}
            element={<OtherPage tab="tournaments" />}
          />
          {/* The tournament detail keeps its existing `/tournaments/:id` route;
              its list now lives under Other → Tournaments. */}
          <Route
            path={routePatterns.tournamentDetail}
            element={<TournamentDetailPage />}
          />
        </>
      )}
    </>
  );
}
