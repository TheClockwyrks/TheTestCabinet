// maze-movement/no-wall — the forager cannot enter rock.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Holding a direction into a rock tile leaves the forager at rest against it:
// its center stops within half a tile of the last open tile's center, its tile
// never becomes the rock tile, and it never reads as moving into it.

import { it } from "vitest";

it("The forager cannot enter rock", () => {
  throw new Error(
    "validation/structured-2d/maze-movement/no-wall.test.ts: not implemented",
  );
});
