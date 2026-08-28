// maze/proportions — the three proportions are in range.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Measured over the corridor tiles alone, with den interior and den gate
// excluded from both the tiles measured and the neighbors counted: openness is
// between MAZE_OPENNESS_MIN (2.0) and MAZE_OPENNESS_MAX (2.8) inclusive, the
// mean corridor-run length is between MAZE_MAZING_MIN (2.0) and
// MAZE_MAZING_MAX (8.0) inclusive, and density is between MAZE_DENSITY_MIN
// (0.40) and MAZE_DENSITY_MAX (1.0) inclusive over the 544 cells inside the
// border.

import { it } from "vitest";

it("The three proportions are in range", () => {
  throw new Error("validation/none/maze/proportions.test.ts: not implemented");
});
