// Deepcore — assets.tile-variants. STUB: NOT YET AUTHORED.
//
// Each band has several interchangeable rock variants
//
// At least TILE_VARIANTS (3) distinct rock sprites exist for each band under
// assets/tiles/, and a wall of one band draws more than one of them, so a face
// of rock never repeats a single stamp.
//
// Automated validation: read the variant files per band and hold the count at
// three or more and every pair different, then read a drawn wall of one band
// and hold more than one variant used across it.
//
// `test-case.toml` declares this suite as `assets/tile-variants.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (wall (image)) around the drive.

import { test } from "vitest";

test("Each band has several interchangeable rock variants", () => {
  throw new Error(
    "Deepcore validator `assets/tile-variants` is declared in test-case.toml but has not been authored yet.",
  );
});
