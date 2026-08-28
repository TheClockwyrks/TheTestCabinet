// maze/no-dead-ends — no dead ends.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Every corridor tile has at least two corridor neighbors, so the maze is
// braided and no corridor ends in a pocket the forager must back out of.

import { it } from "vitest";

it("No dead ends", () => {
  throw new Error(
    "validation/simple-2d/maze/no-dead-ends.test.ts: not implemented",
  );
});
