// Deepcore — generation.gas-density-ramp. STUB: NOT YET AUTHORED.
//
// Gas pockets grow denser with depth
//
// The gas-pocket share of minable cells rises linearly with depthFraction from
// GAS_DENSITY_MIN (0.004) at the top of the rockbed to GAS_DENSITY_MAX (0.012)
// at the bottom of the coreshell, each band share holding within
// DENSITY_TOLERANCE (0.25) of the value the ramp gives its midpoint.
//
// Automated validation: generate mines at several seeds and count gas cells
// per band, holding each share against the ramp at that band midpoint within
// DENSITY_TOLERANCE.
//
// `test-case.toml` declares this suite as `generation/gas-density-ramp.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (pockets (image)) around the drive.

import { test } from "vitest";

test("Gas pockets grow denser with depth", () => {
  throw new Error(
    "Deepcore validator `generation/gas-density-ramp` is declared in test-case.toml but has not been authored yet.",
  );
});
