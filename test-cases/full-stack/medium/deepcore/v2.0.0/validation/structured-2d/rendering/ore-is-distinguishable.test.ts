// Deepcore — rendering.ore-is-distinguishable. STUB: NOT YET AUTHORED.
//
// An ore cell reads differently from plain rock
//
// An ore cell is drawn distinctly from plain rock of the same band, their
// sampled mean colours at least an RGB distance of 30 apart, so a vein is
// spotted rather than stumbled on.
//
// Automated validation: pose an ore cell beside a rock cell of the same band,
// sample both interiors and hold them at least 30 apart.
//
// `test-case.toml` declares this suite as `rendering/ore-is-distinguishable.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (vein (image)) around the drive.

import { test } from "vitest";

test("An ore cell reads differently from plain rock", () => {
  throw new Error(
    "Deepcore validator `rendering/ore-is-distinguishable` is declared in test-case.toml but has not been authored yet.",
  );
});
