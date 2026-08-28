// maze/corridors-one-wide — corridors are one tile wide.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// No 2x2 block of the grid is four corridor tiles, so the corridors wind one
// tile wide and the den chamber, made of den-interior tiles, is the only open
// area wider than that.

import { it } from "vitest";

it("Corridors are one tile wide", () => {
  throw new Error(
    "validation/structured-2d/maze/corridors-one-wide.test.ts: not implemented",
  );
});
