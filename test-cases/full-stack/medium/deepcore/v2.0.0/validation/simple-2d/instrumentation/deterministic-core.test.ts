// Deepcore — instrumentation.deterministic-core. STUB: NOT YET AUTHORED.
//
// An interval of game time is independent of how it is divided into frames
//
// One second of game time advanced as a single frame and as sixty reaches the
// same state: from the same posed fall, the miner position and velocity agree
// to within the drift a change in step size explains.
//
// Automated validation: pose the same fall twice, advance one second in one
// frame and in sixty, and compare the resulting miner position and velocity
// within a stated tolerance.
//
// `test-case.toml` declares this suite as `instrumentation/deterministic-core.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (drive (replay)) around the drive.

import { test } from "vitest";

test("An interval of game time is independent of how it is divided into frames", () => {
  throw new Error(
    "Deepcore validator `instrumentation/deterministic-core` is declared in test-case.toml but has not been authored yet.",
  );
});
