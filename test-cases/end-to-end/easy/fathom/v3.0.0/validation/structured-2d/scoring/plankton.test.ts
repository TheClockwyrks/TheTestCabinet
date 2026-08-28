// scoring/plankton — plankton score SCORE_PLANKTON each.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// The forager entering a tile holding a plankton eats it the moment its center
// enters that tile: score rises by exactly SCORE_PLANKTON (10),
// planktonRemaining falls by exactly 1, and the tile holds no plankton
// afterward.

import { it } from "vitest";

it("Plankton score SCORE_PLANKTON each", () => {
  throw new Error(
    "validation/structured-2d/scoring/plankton.test.ts: not implemented",
  );
});
