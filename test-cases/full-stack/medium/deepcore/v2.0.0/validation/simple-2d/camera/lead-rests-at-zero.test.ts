// Deepcore — camera.lead-rests-at-zero. STUB: NOT YET AUTHORED.
//
// A near-still miner sits at the centre of the view
//
// leadTarget is 0 while the miner vertical speed is at or under
// CAM_STILL_SPEED (40), so boring straight down at near-zero velocity holds
// the miner at the vertical centre and the lead starts at 0.
//
// Automated validation: pose the miner at a vertical speed under
// CAM_STILL_SPEED, advance a sustained span and hold the lead at 0.
//
// `test-case.toml` declares this suite as `camera/lead-rests-at-zero.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (still (replay)) around the drive.

import { test } from "vitest";

test("A near-still miner sits at the centre of the view", () => {
  throw new Error(
    "Deepcore validator `camera/lead-rests-at-zero` is declared in test-case.toml but has not been authored yet.",
  );
});
