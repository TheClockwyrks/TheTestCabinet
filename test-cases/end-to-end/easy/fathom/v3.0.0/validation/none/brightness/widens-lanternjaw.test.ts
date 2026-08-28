// brightness/widens-lanternjaw — brightness widens the Lanternjaw's reach.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A Lanternjaw's detectRange is LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G —
// 128 at G 0 and 320 at G 1, within 1 unit — so the same forager is out of
// reach dim and inside it bright.

import { it } from "vitest";

it("Brightness widens the Lanternjaw's reach", () => {
  throw new Error(
    "validation/none/brightness/widens-lanternjaw.test.ts: not implemented",
  );
});
