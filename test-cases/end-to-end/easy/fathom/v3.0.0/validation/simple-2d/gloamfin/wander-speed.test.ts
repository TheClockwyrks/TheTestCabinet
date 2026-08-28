// gloamfin/wander-speed — it wanders at a steady PREDATOR_SPEED.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A wandering Gloamfin reports speed PREDATOR_SPEED (116) and covers ground at
// that rate within 2 percent, and it reads the same after a minute of
// wandering as it does a moment after release, so there is no wind-up over
// time.

import { it } from "vitest";

it("It wanders at a steady PREDATOR_SPEED", () => {
  throw new Error(
    "validation/simple-2d/gloamfin/wander-speed.test.ts: not implemented",
  );
});
