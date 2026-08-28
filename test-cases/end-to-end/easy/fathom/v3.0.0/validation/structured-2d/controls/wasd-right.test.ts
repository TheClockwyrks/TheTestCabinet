// controls/wasd-right — keyD swims the forager right.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// KeyD drives the right action exactly as ArrowRight does: held on an open
// corridor it starts the forager traveling with dir right.

import { it } from "vitest";

it("KeyD swims the forager right", () => {
  throw new Error(
    "validation/structured-2d/controls/wasd-right.test.ts: not implemented",
  );
});
