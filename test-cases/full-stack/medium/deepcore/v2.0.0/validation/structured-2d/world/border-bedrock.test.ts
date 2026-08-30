// Deepcore — world.border-bedrock. STUB: NOT YET AUTHORED.
//
// Columns 0 and 31 are bedrock border
//
// Every cell of column 0 and column 31 reads as bedrock at every row, so the
// playable field is columns 1 through 30 and WORLD_COLS is 32.
//
// Automated validation: read tileAt down both border columns at rows across
// all four bands and hold each kind against bedrock.
//
// `test-case.toml` declares this suite as `world/border-bedrock.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (border (image)) around the drive.

import { test } from "vitest";

test("Columns 0 and 31 are bedrock border", () => {
  throw new Error(
    "Deepcore validator `world/border-bedrock` is declared in test-case.toml but has not been authored yet.",
  );
});
