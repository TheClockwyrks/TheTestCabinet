// scoring/depth-scaling — depth adds hunters and shortens the pulse.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// At depths 1 through 5 the roster holds the counts specs/predators.md
// tabulates — one of each kind at depth 1, adding a Gloamfin, then a
// Lanternjaw, then a Flarefish, and holding at ROSTER_CAP (two of each, six in
// all) from ROSTER_CAP_DEPTH (4) on — listed in release order, while
// sonar.range is max(SONAR_RANGE_MIN (5), SONAR_RANGE_BASE (9) - (d - 1)) and
// a pulse emitted at that depth carries exactly that range. No predator speed
// changes with depth.

import { it } from "vitest";

it("Depth adds hunters and shortens the pulse", () => {
  throw new Error(
    "validation/simple-2d/scoring/depth-scaling.test.ts: not implemented",
  );
});
