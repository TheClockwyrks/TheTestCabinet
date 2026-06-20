import { Navigate } from "react-router";
import { RunDetailLayout } from "../../../layouts/runs/RunDetailLayout";
import { routes } from "../../../routes";
import { PlayableSection } from "../PlayableSection";

// The Play tab (`/runs/:runId/play`): the model's implementation exactly as it
// was written. The build never auto-loads — PlayableSection gates it behind an
// explicit launch, showing a generic caveat first. The reviewer's verdict lives
// on the Verdict tab.
export function RunPlayPage() {
  return (
    <RunDetailLayout tab="play">
      {({ run }) =>
        // An asset-generation run produces a static asset, not a playable build,
        // so it has no Play tab (RunDetailLayout omits it). A direct deep-link to
        // this route still resolves here, though, so redirect to the Verdict tab
        // where its result is shown rather than rendering an empty player.
        run.subject.testType === "asset-generation" ? (
          <Navigate to={routes.runDetail(run.id)} replace />
        ) : (
          <PlayableSection run={run} />
        )
      }
    </RunDetailLayout>
  );
}
