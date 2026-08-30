// Wireworm — instrumentation.foe-spawn-gate, under the `none` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// Foe spawning off keeps the level's foes away
//
// With setFoeSpawning(false) at level 5, no foe joins the roster over a minute
// of play; with it on, the roster is no longer empty.

import { test } from "vitest";

test("instrumentation.foe-spawn-gate", () => {
  throw new Error(
    "wireworm v2.0.0: validation/none/instrumentation/foe-spawn-gate.test.ts has not been written yet",
  );
});
