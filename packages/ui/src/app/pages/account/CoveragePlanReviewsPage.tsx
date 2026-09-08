import { useCoveragePlan } from "./CoveragePlanLayout";
import { CoverageReviewQueue } from "./CoverageReviewQueue";

// The plan's Reviews tab (`/account/coverage/:planId/reviews`): the completed runs of
// this plan waiting on the signed-in reviewer, each row opening straight into its
// verdict.
//
// The order is the plan's own emission order rather than newest-first: the buffer was
// filled deliberately so a cell's repeats arrive adjacent, and walking them in that
// order is what lets them be judged against each other. Reviewing a run and pressing
// back returns to this tab, so the loop is open, review, back, repeat.
export function CoveragePlanReviewsPage() {
  const { queue } = useCoveragePlan();
  return (
    <CoverageReviewQueue
      // A host whose transport cannot serve the queue reads as an empty one rather
      // than as a blank tab: either way there is nothing here to open, and a surface
      // that renders nothing at all cannot be told from a bug.
      queue={queue ?? { runs: [], truncated: false }}
      returnLabel="Back to the plan's reviews"
      emptyMessage="Nothing is waiting on you. Runs land here as this plan's cells complete, in the order the plan ran them."
    />
  );
}
