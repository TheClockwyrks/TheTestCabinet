// Deepcore — movement.walk-speed. STUB: NOT YET AUTHORED.
//
// Walking runs at the stated speed
//
// Holding left or right on the ground moves the miner horizontally at
// WALK_SPEED (250) units per second, so a second of held walk covers 250
// units.
//
// Automated validation: clear a level corridor, hold right with the drill off
// for a fixed span, and hold the distance covered against WALK_SPEED times the
// span.
//
// `test-case.toml` declares this suite as `movement/walk-speed.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (walk (replay)) around the drive.

import { test } from "vitest";

test("Walking runs at the stated speed", () => {
  throw new Error(
    "Deepcore validator `movement/walk-speed` is declared in test-case.toml but has not been authored yet.",
  );
});
