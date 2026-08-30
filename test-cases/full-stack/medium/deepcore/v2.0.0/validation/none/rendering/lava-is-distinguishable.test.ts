// Deepcore — rendering.lava-is-distinguishable. STUB: NOT YET AUTHORED.
//
// Lava reads as lava, not as rock
//
// A lava cell is drawn distinctly from its band rock: their sampled mean
// colors are at least an RGB distance of 60 apart, so a pool is visible before
// the miner is in it.
//
// Automated validation: pose a lava cell beside a rock cell of the same band,
// sample both interiors and hold them at least 60 apart.
//
// `test-case.toml` declares this suite as `rendering/lava-is-distinguishable.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (lava (image)) around the drive.

import { test } from "vitest";

test("Lava reads as lava, not as rock", () => {
  throw new Error(
    "Deepcore validator `rendering/lava-is-distinguishable` is declared in test-case.toml but has not been authored yet.",
  );
});
