// Deepcore — generation.lava-density-ramp. STUB: NOT YET AUTHORED.
//
// Lava grows denser with depth
//
// The lava share of minable cells rises linearly with depthFraction from
// LAVA_DENSITY_MIN (0.03) at the top of the deepstone to LAVA_DENSITY_MAX
// (0.10) at the bottom of the coreshell, each band share holding within
// DENSITY_TOLERANCE (0.25) of the value the ramp gives its midpoint.
//
// Automated validation: generate mines at several seeds and count lava cells
// in the deepstone and coreshell, holding each share against the ramp within
// DENSITY_TOLERANCE.
//
// `test-case.toml` declares this suite as `generation/lava-density-ramp.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (pools (image)) around the drive.

import { test } from "vitest";

test("Lava grows denser with depth", () => {
  throw new Error(
    "Deepcore validator `generation/lava-density-ramp` is declared in test-case.toml but has not been authored yet.",
  );
});
