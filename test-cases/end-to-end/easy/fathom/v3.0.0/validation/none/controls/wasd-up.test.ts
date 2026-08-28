// controls/wasd-up — keyW swims the forager up.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// KeyW drives the up action exactly as ArrowUp does: held on an open corridor
// it starts the forager traveling with dir up.

import { it } from "vitest";

it("KeyW swims the forager up", () => {
  throw new Error("validation/none/controls/wasd-up.test.ts: not implemented");
});
