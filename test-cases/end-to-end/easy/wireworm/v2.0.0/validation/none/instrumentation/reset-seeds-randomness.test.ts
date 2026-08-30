// Wireworm — instrumentation.reset-seeds-randomness, under the `none` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// reset seeds the game's randomness
//
// Two runs started after reset({ seed: 7 }) lay the identical starting
// scatter, and a run after reset({ seed: 8 }) lays a different one.

import { test } from "vitest";

test("instrumentation.reset-seeds-randomness", () => {
  throw new Error(
    "wireworm v2.0.0: validation/none/instrumentation/reset-seeds-randomness.test.ts has not been written yet",
  );
});
