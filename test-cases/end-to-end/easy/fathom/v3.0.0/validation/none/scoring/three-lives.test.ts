// scoring/three-lives — three lives, then game over.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A dive opens with lives START_LIVES (3) and the life being played is not
// counted, so three catches drop lives to 2, 1 and 0 with play resuming each
// time, and the fourth catch, taken with lives already 0, sets screen to
// gameover.

import { it } from "vitest";

it("Three lives, then game over", () => {
  throw new Error(
    "validation/none/scoring/three-lives.test.ts: not implemented",
  );
});
