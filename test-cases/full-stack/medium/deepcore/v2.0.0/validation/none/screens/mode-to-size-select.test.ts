// Deepcore — screens.mode-to-size-select. STUB: NOT YET AUTHORED.
//
// Choosing a mode opens the size choice
//
// Choosing STANDARD or HARDCORE takes the game to size-select, which states
// each size Core depth in meters before the choice is made.
//
// Automated validation: choose each mode in turn, read the screen at
// size-select and read the drawn frame for the three Core depths.
//
// `test-case.toml` declares this suite as `screens/mode-to-size-select.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (sizes (image)) around the drive.

import { test } from "vitest";

test("Choosing a mode opens the size choice", () => {
  throw new Error(
    "Deepcore validator `screens/mode-to-size-select` is declared in test-case.toml but has not been authored yet.",
  );
});
