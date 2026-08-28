// controls/setmaze-houses-predators — setMaze houses the predators it re-dens.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Posing a layout returns every predator to a den tile with released false and
// SUSPENDS the release schedule, so watching past the third predator's
// ordinary due time — DEN_RELEASE_GAP (5 s) times two after live play began,
// with room to spare — leaves every released flag false. A hunter stopped by
// rock looks exactly like one that was held, so released is what tells them
// apart.

import { it } from "vitest";

it("setMaze houses the predators it re-dens", () => {
  throw new Error(
    "validation/simple-2d/controls/setmaze-houses-predators.test.ts: not implemented",
  );
});
