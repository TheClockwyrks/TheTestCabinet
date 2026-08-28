// fog/unrevealed-black — unrevealed maze is flat dark fog.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A tile nothing has touched reports visibility u and is drawn as flat
// darkness — sampled at the tile's center, no brighter than a tenth of full
// brightness — and a rock tile and a corridor tile that are both unrevealed
// are drawn alike, within an RGB distance of 25 of 441, so the fog does not
// leak the layout.

import { it } from "vitest";

it("Unrevealed maze is flat dark fog", () => {
  throw new Error(
    "validation/simple-2d/fog/unrevealed-black.test.ts: not implemented",
  );
});
