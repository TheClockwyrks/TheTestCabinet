import { JamDetailLayout } from "../../../layouts/gamejams/JamDetailLayout";
import { LeaderboardContent } from "../../testcases/[slug]/TestCaseLeaderboardPage";

// The Leaderboard tab (`/game-jams/:slug/leaderboard`): each model that has a
// scored run of the selected variant, ranked by average points — the same shared
// board the test-case Leaderboard tab renders. A jam has no scoring domains, so
// the board's badge cell shows the model's best/worst whole-game overall grade in
// place of a rating.
export function JamLeaderboardPage() {
  return (
    <JamDetailLayout tab="leaderboard">
      {({ testCase, variant }) => (
        <LeaderboardContent testCase={testCase} variant={variant} />
      )}
    </JamDetailLayout>
  );
}
