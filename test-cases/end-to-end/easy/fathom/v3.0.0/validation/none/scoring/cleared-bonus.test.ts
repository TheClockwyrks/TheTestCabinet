// scoring/cleared-bonus — clearing a maze scores SCORE_CLEAR.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Eating the plankton that leaves none behind adds SCORE_CLEAR (500) on top of
// that plankton's own SCORE_PLANKTON (10), for exactly 510 across the bite,
// and screen becomes cleared.

import { it } from "vitest";

it("Clearing a maze scores SCORE_CLEAR", () => {
  throw new Error(
    "validation/none/scoring/cleared-bonus.test.ts: not implemented",
  );
});
