// lanternjaw/wander-disguise — it wanders at the drifter's pace and hunts faster.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// An unfixed Lanternjaw reports speed DRIFTER_SPEED (64) and covers ground at
// that rate within 2 percent, and the instant it takes a fix its speed becomes
// PREDATOR_SPEED (116), also within 2 percent, which is below the forager's
// FORAGER_SPEED (128).

import { it } from "vitest";

it("It wanders at the drifter's pace and hunts faster", () => {
  throw new Error(
    "validation/structured-2d/lanternjaw/wander-disguise.test.ts: not implemented",
  );
});
