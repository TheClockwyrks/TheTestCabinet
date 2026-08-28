// states/paused — the pause screen freezes the dive.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Pausing live play sets screen to paused and draws a menu of RESUME, RESTART
// and QUIT TO MENU over a maze that stays visible, and nothing advances behind
// it: over a stretch of simulated time no position, cooldown or brightness
// changes, and RESUME returns to playing.

import { it } from "vitest";

it("The pause screen freezes the dive", () => {
  throw new Error(
    "validation/simple-2d/states/paused.test.ts: not implemented",
  );
});
