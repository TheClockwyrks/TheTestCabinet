// Deepcore — movement.air-drift. STUB: NOT YET AUTHORED.
//
// Lateral movement works in the air as well as on the ground
//
// Holding left or right while airborne drifts the miner sideways at the same
// WALK_SPEED (250), so a fall can be steered into a neighbouring shaft.
//
// Automated validation: clear a wide open space, drop the miner with right
// held and the drill off, and hold the horizontal distance covered against
// WALK_SPEED times the span.
//
// `test-case.toml` declares this suite as `movement/air-drift.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (drift (replay)) around the drive.

import { test } from "vitest";

test("Lateral movement works in the air as well as on the ground", () => {
  throw new Error(
    "Deepcore validator `movement/air-drift` is declared in test-case.toml but has not been authored yet.",
  );
});
