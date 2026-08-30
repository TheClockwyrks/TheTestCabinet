// Wireworm — scoring.bonus-life, under the `simple-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// A bonus life at every 12,000 points
//
// A score posed at 11,950 that crosses BONUS_LIFE_EVERY (12,000) through real
// scoring grants one extra life. The other direction — that posing the score
// across the boundary grants nothing — is instrumentation.set-score-grants-no-
// life.

import { test } from "vitest";

test("scoring.bonus-life", () => {
  throw new Error(
    "wireworm v2.0.0: validation/simple-2d/scoring/bonus-life.test.ts has not been written yet",
  );
});
