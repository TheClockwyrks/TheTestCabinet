// Deepcore — fuel.drill-hit-fuel. STUB: NOT YET AUTHORED.
//
// Each drill hit spends fuel
//
// Each drill hit spends DRILL_HIT_FUEL (0.25) fuel, so breaking a cell costs
// ceil(BAND_HEALTH / damagePerHit) times that: 1 fuel for a topsoil cell at
// tier 1 and 4 for a coreshell one.
//
// Automated validation: cut a posed cell in each band through to breaking with
// travel off and hold the fuel spent against the hits it took times
// DRILL_HIT_FUEL, net of life support.
//
// `test-case.toml` declares this suite as `fuel/drill-hit-fuel.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cost (replay)) around the drive.

import { test } from "vitest";

test("Each drill hit spends fuel", () => {
  throw new Error(
    "Deepcore validator `fuel/drill-hit-fuel` is declared in test-case.toml but has not been authored yet.",
  );
});
