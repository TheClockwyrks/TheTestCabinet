// alert/lanternjaw-none — the Lanternjaw fires no alert.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A Lanternjaw reports alert false at every moment, through an acquisition and
// across the ALERT_TIME (0.5 s) window after it, because its standing bulb is
// its tell.

import { it } from "vitest";

it("The Lanternjaw fires no alert", () => {
  throw new Error(
    "validation/simple-2d/alert/lanternjaw-none.test.ts: not implemented",
  );
});
