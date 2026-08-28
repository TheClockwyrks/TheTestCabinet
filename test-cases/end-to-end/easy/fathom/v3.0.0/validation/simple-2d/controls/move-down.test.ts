// controls/move-down — arrowDown swims the forager down.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// On an open corridor, holding ArrowDown starts the forager traveling: moving
// is true, dir is down, and its y rises.

import { it } from "vitest";

it("ArrowDown swims the forager down", () => {
  throw new Error(
    "validation/simple-2d/controls/move-down.test.ts: not implemented",
  );
});
