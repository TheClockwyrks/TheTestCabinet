// Deepcore — generation.ore-density. STUB: NOT YET AUTHORED.
//
// Ore veins occupy their stated share of the mine
//
// Ore veins occupy ORE_DENSITY (0.14) of the minable cells within
// DENSITY_TOLERANCE (0.25) of that value, measured over a whole band, and the
// share is the same at every depth rather than spiking in one stratum.
//
// Automated validation: generate mines at several seeds and count ore cells
// against minable cells over each band in turn, holding each share against
// ORE_DENSITY within DENSITY_TOLERANCE.
//
// `test-case.toml` declares this suite as `generation/ore-density.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (veins (image)) around the drive.

import { test } from "vitest";

test("Ore veins occupy their stated share of the mine", () => {
  throw new Error(
    "Deepcore validator `generation/ore-density` is declared in test-case.toml but has not been authored yet.",
  );
});
