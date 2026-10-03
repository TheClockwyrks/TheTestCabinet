import { useCoveragePlan } from "./CoveragePlanLayout";
import { CoverageReviewQueue } from "./CoverageReviewQueue";

// The plan's Reviews tab (`/account/coverage/:planId/reviews`): the completed runs of
// this plan the signed-in reviewer has not reviewed, each row opening straight into its
// verdict. Informational: a review is optional labelling and never launches or holds
// back a run.
//
// The order is the plan's own emission order rather than newest-first: a plan launches
// a cell's repeats together, so walking them in that order is what lets them be judged
// against each other. Reviewing a run and pressing back returns to this tab.
export function CoveragePlanReviewsPage() {
  const { queue } = useCoveragePlan();
  return (
    <CoverageReviewQueue
      // A host whose transport cannot serve the queue reads as an empty one rather
      // than as a blank tab: either way there is nothing here to open, and a surface
      // that renders nothing at all cannot be told from a bug.
      queue={queue ?? { runs: [], truncated: false }}
      returnLabel="Back to the plan's reviews"
      intro="Completed runs of this plan you have not reviewed, in the order the plan runs them. A review adds an aesthetic rating and a writeup after the fact; it never launches or holds back a run."
      emptyMessage="No unreviewed runs. Completed runs of this plan land here, in the order the plan runs them."
    />
  );
}
