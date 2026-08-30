// Deepcore — core-run.timer-runs-in-a-panel. STUB: NOT YET AUTHORED.
//
// The timer never pauses while the expedition runs
//
// The timer counts down in game time at the surface, inside a building panel
// and inside the inventory overlay alike, so no screen is a safe place to hide
// from it.
//
// Automated validation: pose a carried Sample, open a panel and then the
// inventory and hold the timer falling across a fixed span in each.
//
// `test-case.toml` declares this suite as `core-run/timer-runs-in-a-panel.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (ticking (replay)) around the drive.

import { test } from "vitest";

test("The timer never pauses while the expedition runs", () => {
  throw new Error(
    "Deepcore validator `core-run/timer-runs-in-a-panel` is declared in test-case.toml but has not been authored yet.",
  );
});
