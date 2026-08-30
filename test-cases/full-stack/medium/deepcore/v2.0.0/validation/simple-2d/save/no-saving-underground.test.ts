// Deepcore — save.no-saving-underground. STUB: NOT YET AUTHORED.
//
// There is no saving underground and no autosave
//
// The Save Pad is the only way to save: no save is written by descending,
// selling, buying, dying or advancing time, so an expedition that never visits
// the pad has no save.
//
// Automated validation: clear the save, drive a full surface loop and a
// descent without touching the pad and read hasSave still false.
//
// `test-case.toml` declares this suite as `save/no-saving-underground.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (none (replay)) around the drive.

import { test } from "vitest";

test("There is no saving underground and no autosave", () => {
  throw new Error(
    "Deepcore validator `save/no-saving-underground` is declared in test-case.toml but has not been authored yet.",
  );
});
