// maze/connected — one connected region.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Every corridor tile is reachable from every other by moving between corridor
// neighbors — the wrap tunnel's two mouths counting as neighbors — so the
// forager's start tile, both mouths, and every plankton lie in one region.

import { it } from "vitest";

it("One connected region", () => {
  throw new Error(
    "validation/simple-2d/maze/connected.test.ts: not implemented",
  );
});
