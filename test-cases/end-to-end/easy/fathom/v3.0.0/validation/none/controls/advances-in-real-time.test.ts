// controls/advances-in-real-time — the game advances itself in real time.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// On a real wall clock, with nothing stepping the game from outside, live play
// advances: simTime rises and a released predator's position changes over a
// stretch of real time.

import { it } from "vitest";

it("The game advances itself in real time", () => {
  throw new Error(
    "validation/none/controls/advances-in-real-time.test.ts: not implemented",
  );
});
