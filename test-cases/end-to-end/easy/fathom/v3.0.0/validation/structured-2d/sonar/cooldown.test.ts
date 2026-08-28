// sonar/cooldown — sonar recharges over SONAR_COOLDOWN.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Emitting a pulse sets sonar.cooldown to SONAR_COOLDOWN (1.5 s) and
// sonar.ready to false, the cooldown runs down with simulated time, a second
// press before it reaches 0 puts no pulse in flight, and ready returns true
// exactly when the cooldown reaches 0.

import { it } from "vitest";

it("Sonar recharges over SONAR_COOLDOWN", () => {
  throw new Error(
    "validation/structured-2d/sonar/cooldown.test.ts: not implemented",
  );
});
