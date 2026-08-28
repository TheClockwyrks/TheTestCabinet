// ink/cooldown — ink recharges over INK_COOLDOWN.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Releasing a cloud sets ink.cooldown to INK_COOLDOWN (8 s) and ink.ready to
// false, the cooldown runs down with simulated time, a second press before it
// reaches 0 releases no cloud, and ready returns true exactly when the
// cooldown reaches 0.

import { it } from "vitest";

it("Ink recharges over INK_COOLDOWN", () => {
  throw new Error("validation/simple-2d/ink/cooldown.test.ts: not implemented");
});
