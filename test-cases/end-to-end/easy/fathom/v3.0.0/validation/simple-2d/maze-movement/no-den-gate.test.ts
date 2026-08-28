// maze-movement/no-den-gate — the forager cannot cross the den gate.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// The gate is the predators' door alone: holding the direction into the den
// gate from the corridor outside it leaves the forager on the corridor side,
// never standing on the gate tile or on a den-interior tile.

import { it } from "vitest";

it("The forager cannot cross the den gate", () => {
  throw new Error(
    "validation/simple-2d/maze-movement/no-den-gate.test.ts: not implemented",
  );
});
