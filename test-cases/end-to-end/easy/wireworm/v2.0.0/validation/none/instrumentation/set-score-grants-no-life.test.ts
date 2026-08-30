// Wireworm — instrumentation.set-score-grants-no-life, under the `none` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// Posing the score grants no bonus life
//
// setScore across a BONUS_LIFE_EVERY (12,000) boundary leaves lives exactly as
// it was: the award belongs to the scoring path, and a pose is a precondition.

import { test } from "vitest";

test("instrumentation.set-score-grants-no-life", () => {
  throw new Error(
    "wireworm v2.0.0: validation/none/instrumentation/set-score-grants-no-life.test.ts has not been written yet",
  );
});
