// Deepcore — audio.alarm-fuel-cue. STUB: NOT YET AUTHORED.
//
// The low-fuel alarm plays under the threshold
//
// The alarm-fuel cue plays when fuel drops below LOW_FUEL_FRACTION (0.2) of
// the maximum, and does not play above it.
//
// Automated validation: burn fuel across the threshold and observe the alarm
// played only once it is crossed.
//
// `test-case.toml` declares this suite as `audio/alarm-fuel-cue.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (alarm (replay)) around the drive.

import { test } from "vitest";

test("The low-fuel alarm plays under the threshold", () => {
  throw new Error(
    "Deepcore validator `audio/alarm-fuel-cue` is declared in test-case.toml but has not been authored yet.",
  );
});
