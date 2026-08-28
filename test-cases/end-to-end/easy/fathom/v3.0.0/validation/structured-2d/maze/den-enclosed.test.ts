// maze/den-enclosed — the den chamber is enclosed.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// No den-interior tile has a corridor neighbor, so the chamber's only opening
// onto the corridors is its gate.

import { it } from "vitest";

it("The den chamber is enclosed", () => {
  throw new Error(
    "validation/structured-2d/maze/den-enclosed.test.ts: not implemented",
  );
});
