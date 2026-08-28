// maze-movement/turn-at-center — turns are taken at tile centers.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A perpendicular direction held mid-tile is buffered: the forager keeps its
// old heading until its center reaches the next tile center, and only there
// does dir change and the new axis begin, with its off-axis coordinate within
// 1 unit of that center's.

import { it } from "vitest";

it("Turns are taken at tile centers", () => {
  throw new Error(
    "validation/none/maze-movement/turn-at-center.test.ts: not implemented",
  );
});
