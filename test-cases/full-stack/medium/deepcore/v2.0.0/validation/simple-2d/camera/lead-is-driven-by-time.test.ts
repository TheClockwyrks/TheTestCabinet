// Deepcore — camera.lead-is-driven-by-time. STUB: NOT YET AUTHORED.
//
// The lead builds over the same two seconds however fast the miner moves
//
// The build in one direction is driven by time rather than by speed, so a slow
// drift just past CAM_STILL_SPEED and a terminal-speed plunge both reach full
// lead over CAM_LEAD_RAMP (2) seconds, and the lead never overshoots
// leadTarget within an update.
//
// Automated validation: drive a slow descent and a terminal-speed one and
// sample the lead against the same ramp in both, checking no sample passes
// CAM_LEAD_MAX.
//
// `test-case.toml` declares this suite as `camera/lead-is-driven-by-time.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (ramp (replay)) around the drive.

import { test } from "vitest";

test("The lead builds over the same two seconds however fast the miner moves", () => {
  throw new Error(
    "Deepcore validator `camera/lead-is-driven-by-time` is declared in test-case.toml but has not been authored yet.",
  );
});
