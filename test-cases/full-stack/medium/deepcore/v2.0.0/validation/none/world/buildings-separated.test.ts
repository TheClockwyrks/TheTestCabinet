// Deepcore — world.buildings-separated. STUB: NOT YET AUTHORED.
//
// The buildings are separated and clear of the cave mouth
//
// No two building footprints overlap, any two are separated horizontally by at
// least BUILDING_GAP (40) units of clear ground, and no footprint covers any
// part of the cell (CAVE_MOUTH_COL, 1).
//
// Automated validation: read buildings() and check every pair for overlap and
// horizontal separation, then check each footprint against the cave mouth cell
// rectangle.
//
// `test-case.toml` declares this suite as `world/buildings-separated.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (gaps (image)) around the drive.

import { test } from "vitest";

test("The buildings are separated and clear of the cave mouth", () => {
  throw new Error(
    "Deepcore validator `world/buildings-separated` is declared in test-case.toml but has not been authored yet.",
  );
});
