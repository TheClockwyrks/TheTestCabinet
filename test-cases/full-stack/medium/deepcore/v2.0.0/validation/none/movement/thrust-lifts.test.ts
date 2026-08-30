// Deepcore — movement.thrust-lifts. STUB: NOT YET AUTHORED.
//
// The jetpack lifts the miner
//
// Holding the thrust action with an empty bay accelerates the miner upward and
// carries it up through open tunnel, so a shaft already carved can be climbed.
//
// Automated validation: clear a vertical shaft, pose the miner at its foot
// with an empty bay and hold thrust, then hold the resulting position above
// where it started.
//
// `test-case.toml` declares this suite as `movement/thrust-lifts.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (climb (replay)) around the drive.

import { test } from "vitest";

test("The jetpack lifts the miner", () => {
  throw new Error(
    "Deepcore validator `movement/thrust-lifts` is declared in test-case.toml but has not been authored yet.",
  );
});
