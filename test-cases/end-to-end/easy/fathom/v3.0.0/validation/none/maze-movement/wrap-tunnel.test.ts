// maze-movement/wrap-tunnel — the wrap tunnel is one continuous step.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// On the build's own board, traveling off one mouth of the pierced row carries
// the forager onto the other mouth on the same row, covering TILE (32) units
// for the crossing within 2 units, at the speed it was already making, with
// its center staying inside the maze region x in [64, 1216] throughout.

import { it } from "vitest";

it("The wrap tunnel is one continuous step", () => {
  throw new Error(
    "validation/none/maze-movement/wrap-tunnel.test.ts: not implemented",
  );
});
