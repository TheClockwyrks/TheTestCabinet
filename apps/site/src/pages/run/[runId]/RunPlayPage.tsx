import { RunDetailLayout } from "../../../layouts/run/RunDetailLayout";
import { PlayableSection } from "../PlayableSection";

// The Play tab (`/runs/:runId/play`): the model's implementation exactly as it
// was written. The build never auto-loads — PlayableSection gates it behind an
// explicit launch, showing a generic caveat first. The reviewer's verdict lives
// on the Verdict tab.
export function RunPlayPage() {
  return (
    <RunDetailLayout tab="play">
      {({ run }) => <PlayableSection run={run} />}
    </RunDetailLayout>
  );
}
