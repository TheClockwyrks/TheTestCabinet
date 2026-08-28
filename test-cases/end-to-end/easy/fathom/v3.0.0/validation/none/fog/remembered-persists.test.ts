// fog/remembered-persists — revealed terrain is remembered.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A tile the forager's light has lit reports visibility r once the light moves
// off it, stays r for the rest of the maze, and is still drawn — sampled at
// its center it differs from the unrevealed fog by more than 25 of 441 RGB
// distance.

import { it } from "vitest";

it("Revealed terrain is remembered", () => {
  throw new Error(
    "validation/none/fog/remembered-persists.test.ts: not implemented",
  );
});
