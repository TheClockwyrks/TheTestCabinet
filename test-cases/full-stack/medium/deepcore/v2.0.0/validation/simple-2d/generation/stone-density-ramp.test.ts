// Deepcore — generation.stone-density-ramp. STUB: NOT YET AUTHORED.
//
// Unbreakable stone grows denser with depth
//
// The unbreakable-stone share of minable cells rises linearly with
// depthFraction from STONE_DENSITY_MIN (0.02) at the top of the rockbed to
// STONE_DENSITY_MAX (0.08) at the bottom of the coreshell, each band share
// holding within DENSITY_TOLERANCE (0.25) of the value the ramp gives its
// midpoint.
//
// Automated validation: generate mines at several seeds and count stone cells
// per band, holding each share against the ramp at that band midpoint within
// DENSITY_TOLERANCE.
//
// `test-case.toml` declares this suite as `generation/stone-density-ramp.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (boulders (image)) around the drive.

import { test } from "vitest";

test("Unbreakable stone grows denser with depth", () => {
  throw new Error(
    "Deepcore validator `generation/stone-density-ramp` is declared in test-case.toml but has not been authored yet.",
  );
});
