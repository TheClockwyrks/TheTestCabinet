// maze/symmetry — mirror-symmetric about the centerline.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Column c and column GRID_COLS - 1 - c carry the same kind of tile in every
// row — rock mirrors rock and non-rock mirrors non-rock, about the axis
// between columns 17 and 18 — with a pair exempt where either tile is den
// interior or the den gate.

import { it } from "vitest";

it("Mirror-symmetric about the centerline", () => {
  throw new Error(
    "validation/simple-2d/maze/symmetry.test.ts: not implemented",
  );
});
