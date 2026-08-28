// kindle/flare-second-circle — a flare is a second window onto the maze.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A Flarefish blooming beyond the forager's vision circle draws the maze
// inside its bloom: a tile inside FLARE_RADIUS (192) of the Flarefish but
// beyond windowRadius of the forager is drawn while the bloom burns, differing
// from the flat fog by more than an RGB distance of 25 of 441, and is painted
// back to that fog once the bloom ends.

import { it } from "vitest";

it("A flare is a second window onto the maze", () => {
  throw new Error(
    "validation/none/kindle/flare-second-circle.test.ts: not implemented",
  );
});
