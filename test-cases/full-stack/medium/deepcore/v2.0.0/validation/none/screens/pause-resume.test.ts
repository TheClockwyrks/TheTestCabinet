// Deepcore — screens.pause-resume. STUB: NOT YET AUTHORED.
//
// RESUME returns to the mine where it stopped
//
// RESUME closes the pause menu back to in-mine and the simulation continues
// from exactly where it stopped.
//
// Automated validation: pause mid-fall, resume and read the miner continuing
// from the velocity it was paused at.
//
// `test-case.toml` declares this suite as `screens/pause-resume.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (resume (replay)) around the drive.

import { test } from "vitest";

test("RESUME returns to the mine where it stopped", () => {
  throw new Error(
    "Deepcore validator `screens/pause-resume` is declared in test-case.toml but has not been authored yet.",
  );
});
