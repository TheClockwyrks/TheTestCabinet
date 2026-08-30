// Deepcore — weight.climb-acceleration-scales. STUB: NOT YET AUTHORED.
//
// A heavier haul accelerates upward more slowly
//
// The upward acceleration under thrust is emptyAccel * max(0, 1 - load), so a
// miner at half the lift limit climbs at half the empty acceleration and
// gravity contributes nothing further while thrust is held.
//
// Automated validation: pose the cargo at several load fractions, hold thrust
// from rest for a short span in a cleared shaft and hold each acceleration
// against the formula.
//
// `test-case.toml` declares this suite as `weight/climb-acceleration-scales.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (accel (replay)) around the drive.

import { test } from "vitest";

test("A heavier haul accelerates upward more slowly", () => {
  throw new Error(
    "Deepcore validator `weight/climb-acceleration-scales` is declared in test-case.toml but has not been authored yet.",
  );
});
