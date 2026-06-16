import { RunDetailLayout } from "../../../layouts/run/RunDetailLayout";
import { PlayableSection } from "../PlayableSection";

// The Play tab (`/runs/:runId/play`): the model's implementation exactly as it
// was written. The build never auto-loads — PlayableSection gates it behind an
// explicit launch, showing the review (or a generic caveat) first.
export function RunPlayPage() {
  return (
    <RunDetailLayout tab="play">
      {({ run, review }) => <PlayableSection run={run} review={review} />}
    </RunDetailLayout>
  );
}
