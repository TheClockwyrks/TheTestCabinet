// controls/ink-key — shift releases ink.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Pressing ShiftLeft in live play with ink.ready true releases a cloud:
// inkClouds gains an entry centered on the forager, with radius INK_RADIUS
// (80) and remaining INK_LIFE (3 s), both within a tick's tolerance.

import { it } from "vitest";

it("Shift releases ink", () => {
  throw new Error("validation/none/controls/ink-key.test.ts: not implemented");
});
