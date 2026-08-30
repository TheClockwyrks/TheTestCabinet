// Deepcore — weight.climb-cap-scales. STUB: NOT YET AUTHORED.
//
// A heavier haul has a lower climb top speed
//
// The upward speed is capped at emptyClimb * (1 - (1 - CLIMB_CAP_FLOOR) *
// min(1, load)) with CLIMB_CAP_FLOOR 0.58, so weight is felt the whole climb
// and not only at the lift limit.
//
// Automated validation: pose the cargo at several load fractions, hold thrust
// up a long cleared shaft until the speed settles and hold each cap against
// the formula.
//
// `test-case.toml` declares this suite as `weight/climb-cap-scales.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cap (replay)) around the drive.

import { test } from "vitest";

test("A heavier haul has a lower climb top speed", () => {
  throw new Error(
    "Deepcore validator `weight/climb-cap-scales` is declared in test-case.toml but has not been authored yet.",
  );
});
