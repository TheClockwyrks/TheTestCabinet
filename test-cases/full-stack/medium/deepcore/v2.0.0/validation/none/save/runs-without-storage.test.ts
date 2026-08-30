// Deepcore — save.runs-without-storage. STUB: NOT YET AUTHORED.
//
// The game runs correctly when browser storage is unavailable
//
// With the browser storage the save is held in unavailable, the game runs
// correctly and simply without saving: nothing throws, the title carries no
// CONTINUE and the Save Pad reports the refusal.
//
// Automated validation: make the storage the build saves through unavailable,
// then drive a full start, dig and save attempt and hold the game running with
// hasSave false.
//
// `test-case.toml` declares this suite as `save/runs-without-storage.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (no-storage (replay)) around the drive.

import { test } from "vitest";

test("The game runs correctly when browser storage is unavailable", () => {
  throw new Error(
    "Deepcore validator `save/runs-without-storage` is declared in test-case.toml but has not been authored yet.",
  );
});
