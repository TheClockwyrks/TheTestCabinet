// Deepcore — world.grid-geometry. STUB: NOT YET AUTHORED.
//
// A cell occupies its stated rectangle
//
// The cell (col, row) occupies world x in [col * TILE, col * TILE + TILE] and
// y in [row * TILE, row * TILE + TILE] with TILE 80, so a miner dropped down a
// one-column shaft comes to rest with its feet exactly on the top of the first
// solid cell beneath it.
//
// Automated validation: clear a column, pose a solid cell at a known row, drop
// the miner down it and hold the resting position against the cell rectangle.
//
// `test-case.toml` declares this suite as `world/grid-geometry.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (rest (replay)) around the drive.

import { test } from "vitest";

test("A cell occupies its stated rectangle", () => {
  throw new Error(
    "Deepcore validator `world/grid-geometry` is declared in test-case.toml but has not been authored yet.",
  );
});
