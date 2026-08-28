// lanternjaw/light-range — it senses the forager's light within R.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A Lanternjaw with clear line of sight to the forager takes a fix — state
// chase — while the distance between their centers is inside detectRange, and
// holds none while the same pair stands beyond it, with the boundary tested on
// both sides at a posed brightness.

import { it } from "vitest";

it("It senses the forager's light within R", () => {
  throw new Error(
    "validation/simple-2d/lanternjaw/light-range.test.ts: not implemented",
  );
});
