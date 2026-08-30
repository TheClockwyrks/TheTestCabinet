// Deepcore — instrumentation.tile-at-outside-the-grid. STUB: NOT YET AUTHORED.
//
// A cell outside the grid reads as bedrock
//
// tileAt on a column or row outside the grid returns kind bedrock with band,
// ore, material, health and maxHealth all null, rather than throwing or
// returning nothing.
//
// Automated validation: read tileAt at negative coordinates, past WORLD_COLS
// and past coreRow, and hold each result against the documented out-of-grid
// shape.
//
// `test-case.toml` declares this suite as `instrumentation/tile-at-outside-the-grid.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (edge (image)) around the drive.

import { test } from "vitest";

test("A cell outside the grid reads as bedrock", () => {
  throw new Error(
    "Deepcore validator `instrumentation/tile-at-outside-the-grid` is declared in test-case.toml but has not been authored yet.",
  );
});
