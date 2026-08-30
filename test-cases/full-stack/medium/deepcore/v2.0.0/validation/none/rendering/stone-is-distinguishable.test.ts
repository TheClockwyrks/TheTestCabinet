// Deepcore — rendering.stone-is-distinguishable. STUB: NOT YET AUTHORED.
//
// Unbreakable stone reads as a harder material
//
// An unbreakable-stone cell is drawn distinctly from the band rock around it,
// their sampled mean colors at least an RGB distance of 30 apart, so a boulder
// is recognized before the drill is wasted on it.
//
// Automated validation: pose a stone cell beside a rock cell of the same band,
// sample both interiors and hold them at least 30 apart.
//
// `test-case.toml` declares this suite as `rendering/stone-is-distinguishable.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (boulder (image)) around the drive.

import { test } from "vitest";

test("Unbreakable stone reads as a harder material", () => {
  throw new Error(
    "Deepcore validator `rendering/stone-is-distinguishable` is declared in test-case.toml but has not been authored yet.",
  );
});
