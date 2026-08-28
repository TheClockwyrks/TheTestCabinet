// controls/move-left — arrowLeft swims the forager left.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// On an open corridor, holding ArrowLeft starts the forager traveling: moving
// is true, dir is left, and its x falls.

import { it } from "vitest";

it("ArrowLeft swims the forager left", () => {
  throw new Error(
    "validation/none/controls/move-left.test.ts: not implemented",
  );
});
