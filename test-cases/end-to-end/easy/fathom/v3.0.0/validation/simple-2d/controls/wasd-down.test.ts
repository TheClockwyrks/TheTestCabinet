// controls/wasd-down — keyS swims the forager down.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// KeyS drives the down action exactly as ArrowDown does: held on an open
// corridor it starts the forager traveling with dir down.

import { it } from "vitest";

it("KeyS swims the forager down", () => {
  throw new Error(
    "validation/simple-2d/controls/wasd-down.test.ts: not implemented",
  );
});
