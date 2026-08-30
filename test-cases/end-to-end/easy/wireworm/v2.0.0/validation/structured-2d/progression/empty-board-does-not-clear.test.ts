// Wireworm — progression.empty-board-does-not-clear, under the `structured-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// An empty board is playing, not cleared
//
// A board posed with no worm, from which no segment has been removed, is still
// on the same level and still active several seconds later. This is the rule
// the whole harness rests on — startPlaying poses an empty board — so a build
// that clears on it makes every mechanic scenario in the suite unposeable.

import { test } from "vitest";

test("progression.empty-board-does-not-clear", () => {
  throw new Error(
    "wireworm v2.0.0: validation/structured-2d/progression/empty-board-does-not-clear.test.ts has not been written yet",
  );
});
