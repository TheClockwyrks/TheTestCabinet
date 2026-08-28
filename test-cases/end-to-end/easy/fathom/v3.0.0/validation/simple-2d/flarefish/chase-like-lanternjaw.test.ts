// flarefish/chase-like-lanternjaw — a chasing Flarefish neither charges nor blooms.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// While state is chase, flareCharging and flaring both stay false over a
// stretch far longer than FLARE_INTERVAL (7 s), it travels at PREDATOR_SPEED
// (116) within 2 percent, and returning to wander sets the timer to
// FLARE_INTERVAL in full, so the next charge-up is a whole interval away.

import { it } from "vitest";

it("A chasing Flarefish neither charges nor blooms", () => {
  throw new Error(
    "validation/simple-2d/flarefish/chase-like-lanternjaw.test.ts: not implemented",
  );
});
