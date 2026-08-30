// Deepcore — modes.hardcore-deletes-the-save. STUB: NOT YET AUTHORED.
//
// A Hardcore death deletes the save
//
// A Hardcore death deletes the save, so a save banked at the pad does not
// survive it and hasSave reads false at the game-over screen.
//
// Automated validation: save in Hardcore, drive a death and read hasSave false
// with the game-over menu offering no continue.
//
// `test-case.toml` declares this suite as `modes/hardcore-deletes-the-save.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (gone (image)) around the drive.

import { test } from "vitest";

test("A Hardcore death deletes the save", () => {
  throw new Error(
    "Deepcore validator `modes/hardcore-deletes-the-save` is declared in test-case.toml but has not been authored yet.",
  );
});
