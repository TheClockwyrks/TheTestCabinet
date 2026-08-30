// Deepcore — core-run.saving-refused-while-a-sample-is-live. STUB: NOT YET AUTHORED.
//
// Saving is refused while a Sample is live
//
// The Save Pad refuses to save while a Core Sample timer runs, carried or
// jettisoned, so the timer can never be frozen out by saving and quitting.
//
// Automated validation: pose a carried Sample at the Save Pad, save, and read
// hasSave still false, then repeat with one jettisoned.
//
// `test-case.toml` declares this suite as `core-run/saving-refused-while-a-sample-is-live.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (refused (replay)) around the drive.

import { test } from "vitest";

test("Saving is refused while a Sample is live", () => {
  throw new Error(
    "Deepcore validator `core-run/saving-refused-while-a-sample-is-live` is declared in test-case.toml but has not been authored yet.",
  );
});
