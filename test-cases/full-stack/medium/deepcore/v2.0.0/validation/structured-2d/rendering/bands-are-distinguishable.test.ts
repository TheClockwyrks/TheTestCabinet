// Deepcore — rendering.bands-are-distinguishable. STUB: NOT YET AUTHORED.
//
// The four bands read as different rock
//
// The four bands rock is drawn distinctly: sampling the interior of a rock
// cell in each band, no two bands mean colour are within an RGB distance of 40
// of one another, so the depth is readable from the wall.
//
// Automated validation: pose a rock cell in each band, sample the interior of
// each drawn cell and hold every pair of mean colours at least 40 apart.
//
// `test-case.toml` declares this suite as `rendering/bands-are-distinguishable.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (bands (image)) around the drive.

import { test } from "vitest";

test("The four bands read as different rock", () => {
  throw new Error(
    "Deepcore validator `rendering/bands-are-distinguishable` is declared in test-case.toml but has not been authored yet.",
  );
});
