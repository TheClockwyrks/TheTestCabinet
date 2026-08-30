// Wireworm — worm.step-quickens, under the `none` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// The interval shortens each level
//
// The reported wormStepInterval at each level 1..12 is max(WORM_STEP_FLOOR,
// WORM_STEP_L1 * WORM_STEP_DECAY^(level - 1)) — the closed form specs/worm.md
// states — within a tolerance of 0.002 s.

import { test } from "vitest";

test("worm.step-quickens", () => {
  throw new Error(
    "wireworm v2.0.0: validation/none/worm/step-quickens.test.ts has not been written yet",
  );
});
