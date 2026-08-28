// controls/move-right — arrowRight swims the forager right.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// On an open corridor, holding ArrowRight starts the forager traveling: moving
// is true, dir is right, and its x rises.

import { it } from "vitest";

it("ArrowRight swims the forager right", () => {
  throw new Error(
    "validation/structured-2d/controls/move-right.test.ts: not implemented",
  );
});
