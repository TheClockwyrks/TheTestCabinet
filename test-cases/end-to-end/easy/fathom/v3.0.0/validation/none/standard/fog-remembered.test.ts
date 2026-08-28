// standard/fog-remembered — the whole explored map stays drawn.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// There is no vision-circle mask: a tile revealed earlier and reporting
// visibility r is still drawn once the forager has swum far beyond any light
// radius from it — sampled at its center it differs from an unrevealed tile by
// more than an RGB distance of 25 of 441 — however far across the grid it
// lies.

import { it } from "vitest";

it("The whole explored map stays drawn", () => {
  throw new Error(
    "validation/none/standard/fog-remembered.test.ts: not implemented",
  );
});
