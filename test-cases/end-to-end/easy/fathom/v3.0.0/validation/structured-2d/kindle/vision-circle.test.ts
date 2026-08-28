// kindle/vision-circle — the maze is drawn only inside the circle.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// On ground the forager has already revealed, a tile whose center lies inside
// windowRadius of the forager's center is drawn — differing from unrevealed
// fog by more than an RGB distance of 25 of 441 — and a revealed tile whose
// center lies beyond it is painted with that same flat fog, within 25 of 441
// of it, with the boundary tested on both sides.

import { it } from "vitest";

it("The maze is drawn only inside the circle", () => {
  throw new Error(
    "validation/structured-2d/kindle/vision-circle.test.ts: not implemented",
  );
});
