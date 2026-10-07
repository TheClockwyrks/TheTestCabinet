// Orrery — the build's own reference solutions (specs/modes/campaign.md,
// specs/modes/extras.md, specs/formats.md).
//
// One solution per challenge of each mode, in the solution format, reachable
// only through `referenceSolution` on the surface of specs/instrumentation.md.
// Each is legal, places every rise and every set, and completes without
// faulting well inside `CAMPAIGN_REFERENCE_CYCLES` (600).
//
// `src/solutions.test.ts` runs every one of them against its challenge and
// asserts the completion, so a solution that stops working is a red test
// rather than a quiet lie.

import { CAMPAIGN_SOLUTIONS } from "./solutions.campaign";
import { EXTRA_SOLUTIONS } from "./solutions.extras";
import type { Mode } from "./types";

/** The reference solution documents, one per challenge of each mode. */
export const SOLUTION_DOCUMENTS: Record<Mode, unknown[]> = {
  campaign: CAMPAIGN_SOLUTIONS,
  extras: EXTRA_SOLUTIONS,
};
