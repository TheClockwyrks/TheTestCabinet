// Deepcore — modes.standard-save-survives-the-death. STUB: NOT YET AUTHORED.
//
// A Standard save survives the death that used it
//
// The save survives a Standard death and can be restored again, so a second
// death falls back to the same save rather than to nothing.
//
// Automated validation: save, die, continue, die again and read the game-over
// screen still offering the save.
//
// `test-case.toml` declares this suite as `modes/standard-save-survives-the-death.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (again (image)) around the drive.

import { test } from "vitest";

test("A Standard save survives the death that used it", () => {
  throw new Error(
    "Deepcore validator `modes/standard-save-survives-the-death` is declared in test-case.toml but has not been authored yet.",
  );
});
