// Deepcore — fuel.thrust-burn-scales-with-world-size. STUB: NOT YET AUTHORED.
//
// Only the thrust burn is scaled by the world size
//
// The thrust burn alone is multiplied by THRUST_BURN_SIZE_MULT, 2 in a Quick
// mine and 0.67 in a Marathon one against 1 in a Standard mine, while the
// drill, air and life-support drains are the same at every size.
//
// Automated validation: repeat one posed thrust span at each world size and
// hold each burn against the multiplier, then repeat a drill span and hold
// those equal.
//
// `test-case.toml` declares this suite as `fuel/thrust-burn-scales-with-world-size.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (sizes (replay)) around the drive.

import { test } from "vitest";

test("Only the thrust burn is scaled by the world size", () => {
  throw new Error(
    "Deepcore validator `fuel/thrust-burn-scales-with-world-size` is declared in test-case.toml but has not been authored yet.",
  );
});
