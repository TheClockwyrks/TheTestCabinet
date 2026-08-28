// gloamfin/corners-slow — every corner costs it its edge.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A chasing Gloamfin turning onto a perpendicular direction drops to
// GLOAMFIN_CORNER_SPEED (115) within 1 unit per second on that step, below
// FORAGER_SPEED (128), then climbs back to GLOAMFIN_CHASE_SPEED (134)
// GLOAMFIN_RAMP_TIME (2 s) after the turn within a tenth of a second, and a
// straight run and a reversal cost it nothing.

import { it } from "vitest";

it("Every corner costs it its edge", () => {
  throw new Error(
    "validation/simple-2d/gloamfin/corners-slow.test.ts: not implemented",
  );
});
