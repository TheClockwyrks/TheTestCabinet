// maze-movement/constant-speed — the forager travels at a constant speed.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Running a straight corridor, the forager covers ground at FORAGER_SPEED (128
// logical units per second) within 2 percent, measured over a stretch of at
// least four tiles, with no ramp at the start and no drift over the run.

import { it } from "vitest";

it("The forager travels at a constant speed", () => {
  throw new Error(
    "validation/none/maze-movement/constant-speed.test.ts: not implemented",
  );
});
