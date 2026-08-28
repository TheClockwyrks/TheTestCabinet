// states/gameover — game over reports the run and offers the menu.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// The catch taken with lives 0 sets screen to gameover, whose drawn text
// carries the score the run finished on and the depth it reached, over a menu
// of PLAY AGAIN then MENU; PLAY AGAIN opens a fresh dive on the countdown at
// depth 1 with score 0 and lives START_LIVES (3).

import { it } from "vitest";

it("Game over reports the run and offers the menu", () => {
  throw new Error(
    "validation/structured-2d/states/gameover.test.ts: not implemented",
  );
});
