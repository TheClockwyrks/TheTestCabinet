// scoring/caught-costs-life — contact costs a life and sets the board up again.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A predator whose center lies on the forager's tile costs exactly one life:
// lives falls by 1, screen becomes countdown, and the board is set up for
// another attempt — the forager at rest on its start tile with brightness 0,
// every predator back in the den with released false, no drifters, no
// wavefronts, no ink clouds, both cooldowns ready, and planktonRemaining,
// score and depth all unchanged.

import { it } from "vitest";

it("Contact costs a life and sets the board up again", () => {
  throw new Error(
    "validation/simple-2d/scoring/caught-costs-life.test.ts: not implemented",
  );
});
