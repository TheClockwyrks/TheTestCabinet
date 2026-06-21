import { Route } from "react-router";
import { routePatterns } from "../../routes";
import { TournamentsPage } from "./TournamentsPage";
import { TournamentDetailPage } from "./TournamentDetailPage";

// Routes owned by the tournaments section: the list of persisted tournaments and
// one tournament's standings + matches. Both read through the arena capability,
// which only the consoles provide — so they are mounted only where the host can
// execute (the static site never routes here). Returned as a fragment so the
// app's single <Routes> stitches every section's routes together.
export function tournamentsRoutes(canExecute: boolean) {
  if (!canExecute) return null;
  return (
    <>
      <Route path={routePatterns.tournaments} element={<TournamentsPage />} />
      <Route
        path={routePatterns.tournamentDetail}
        element={<TournamentDetailPage />}
      />
    </>
  );
}
