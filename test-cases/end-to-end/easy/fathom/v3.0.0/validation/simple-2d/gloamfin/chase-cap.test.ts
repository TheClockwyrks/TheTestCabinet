// gloamfin/chase-cap — it chases at GLOAMFIN_CHASE_SPEED.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// On a straight run with a fresh fix, a chasing Gloamfin reports speed
// GLOAMFIN_CHASE_SPEED (134) and covers ground at that rate within 2 percent,
// above the forager's FORAGER_SPEED (128) and never above the cap.

import { it } from "vitest";

it("It chases at GLOAMFIN_CHASE_SPEED", () => {
  throw new Error(
    "validation/simple-2d/gloamfin/chase-cap.test.ts: not implemented",
  );
});
