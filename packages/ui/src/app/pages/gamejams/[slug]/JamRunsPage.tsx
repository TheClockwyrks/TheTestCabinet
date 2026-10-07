import { JamDetailLayout } from "../../../layouts/gamejams/JamDetailLayout";
import { RunsContent } from "../../testcases/[slug]/TestCaseRunsPage";

// The Runs tab (`/game-jams/:slug/runs`): the full run log for the anchored
// coordinate, newest first and paged — the same shared body the test-case Runs
// tab renders, scoped the same way. A jam is engineless and single-variant, so
// the engine and variant wideners have nothing to offer and hide themselves.
// Each run's badge is its whole-game overall grade (resolved by the run columns
// from `run.score.overallGrade`) in place of a domain rating.
export function JamRunsPage() {
  return (
    <JamDetailLayout tab="runs">
      {(ctx) => <RunsContent {...ctx} />}
    </JamDetailLayout>
  );
}
