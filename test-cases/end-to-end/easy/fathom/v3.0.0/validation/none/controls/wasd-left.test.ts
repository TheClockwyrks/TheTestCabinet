// controls/wasd-left — keyA swims the forager left.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// KeyA drives the left action exactly as ArrowLeft does: held on an open
// corridor it starts the forager traveling with dir left.

import { it } from "vitest";

it("KeyA swims the forager left", () => {
  throw new Error(
    "validation/none/controls/wasd-left.test.ts: not implemented",
  );
});
