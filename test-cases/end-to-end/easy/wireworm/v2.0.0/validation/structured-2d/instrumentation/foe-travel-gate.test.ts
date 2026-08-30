// Wireworm — instrumentation.foe-travel-gate, under the `structured-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// Travel off holds a foe in place
//
// A glitch with setFoeTravel(id, false) reports the same centre after a second
// of game time as it did at the call. The eating that runs meanwhile is
// foes.glitch-eats-inert's requirement, not this one.

import { test } from "vitest";

test("instrumentation.foe-travel-gate", () => {
  throw new Error(
    "wireworm v2.0.0: validation/structured-2d/instrumentation/foe-travel-gate.test.ts has not been written yet",
  );
});
