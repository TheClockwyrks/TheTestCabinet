// Deepcore — core-run.carried-detonation-kills. STUB: NOT YET AUTHORED.
//
// The timer expiring on a carried Sample kills the miner
//
// The timer reaching 0 while the Sample is carried kills the miner outright
// whatever its hull, ending the expedition with the death cause
// core-detonation.
//
// Automated validation: pose a carried Sample with a short timer and a full
// hull, run the timer out and read the screen and the summary death cause.
//
// `test-case.toml` declares this suite as `core-run/carried-detonation-kills.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (detonation (replay)) around the drive.

import { test } from "vitest";

test("The timer expiring on a carried Sample kills the miner", () => {
  throw new Error(
    "Deepcore validator `core-run/carried-detonation-kills` is declared in test-case.toml but has not been authored yet.",
  );
});
