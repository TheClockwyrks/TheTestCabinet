// Deepcore — instrumentation.find-tile. STUB: NOT YET AUTHORED.
//
// findTile reports the nearest cell of a kind, and null where none exists
//
// On a cleared mine with two posed lava cells, findTile(lava) reports the one
// nearer the miner; with the mine cleared of lava entirely it reports null
// rather than a stale or invented cell.
//
// Automated validation: clear the mine, pose two cells of one kind at known
// distances from the miner, read findTile, then clear them and read it again.
//
// `test-case.toml` declares this suite as `instrumentation/find-tile.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (nearest (image)) around the drive.

import { test } from "vitest";

test("findTile reports the nearest cell of a kind, and null where none exists", () => {
  throw new Error(
    "Deepcore validator `instrumentation/find-tile` is declared in test-case.toml but has not been authored yet.",
  );
});
