// Deepcore — world.band-boundaries. STUB: NOT YET AUTHORED.
//
// A row belongs to the band its depth fraction puts it in
//
// The band of a minable row is min(3, floor(4 * depthFraction(row))) with
// depthFraction(row) = (row - 1) / (coreRow - 1), so at the Standard size rows
// 1 to 125 read topsoil, 126 to 250 rockbed, 251 to 375 deepstone and 376 to
// 499 coreshell.
//
// Automated validation: read tileAt band at each band boundary row and at the
// row either side of it, and hold each against the formula.
//
// `test-case.toml` declares this suite as `world/band-boundaries.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (bands (image)) around the drive.

import { test } from "vitest";

test("A row belongs to the band its depth fraction puts it in", () => {
  throw new Error(
    "Deepcore validator `world/band-boundaries` is declared in test-case.toml but has not been authored yet.",
  );
});
