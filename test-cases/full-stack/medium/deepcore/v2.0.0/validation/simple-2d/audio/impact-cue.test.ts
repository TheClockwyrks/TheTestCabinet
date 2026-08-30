// Deepcore — audio.impact-cue. STUB: NOT YET AUTHORED.
//
// A hard landing plays the impact cue
//
// The impact cue plays when the miner lands above IMPACT_SAFE_SPEED, and not
// on a landing at or below it.
//
// Automated validation: land the miner above and below the safe speed and
// observe the cue at the hard landing alone.
//
// `test-case.toml` declares this suite as `audio/impact-cue.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (thud (replay)) around the drive.

import { test } from "vitest";

test("A hard landing plays the impact cue", () => {
  throw new Error(
    "Deepcore validator `audio/impact-cue` is declared in test-case.toml but has not been authored yet.",
  );
});
