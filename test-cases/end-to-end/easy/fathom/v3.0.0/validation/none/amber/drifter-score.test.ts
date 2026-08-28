// amber/drifter-score — eating a drifter scores SCORE_DRIFTER.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A drifter whose center lies on the forager's tile is eaten: score rises by
// exactly SCORE_DRIFTER (200), the drifter leaves drifters, and
// planktonRemaining is unchanged.

import { it } from "vitest";

it("Eating a drifter scores SCORE_DRIFTER", () => {
  throw new Error(
    "validation/none/amber/drifter-score.test.ts: not implemented",
  );
});
