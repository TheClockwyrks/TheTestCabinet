// brightness/holds-decays — brightness holds, then decays.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// After eating, G is unchanged over the whole BRIGHT_HOLD (1.0 s) window
// within 0.01, and from then on it halves every BRIGHT_HALFLIFE (0.9 s) within
// 0.02 — so it is never a constant drain and never decays during the hold —
// and a further plankton eaten mid-decay arms the hold in full again.

import { it } from "vitest";

it("Brightness holds, then decays", () => {
  throw new Error(
    "validation/none/brightness/holds-decays.test.ts: not implemented",
  );
});
