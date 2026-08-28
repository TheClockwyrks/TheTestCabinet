// controls/move-up — arrowUp swims the forager up.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// On an open corridor, holding ArrowUp starts the forager traveling: moving is
// true, dir is up, and its y falls.

import { it } from "vitest";

it("ArrowUp swims the forager up", () => {
  throw new Error("validation/none/controls/move-up.test.ts: not implemented");
});
