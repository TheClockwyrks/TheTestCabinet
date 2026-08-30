// Deepcore — hazards.impact-damage. STUB: NOT YET AUTHORED.
//
// A hard landing costs hull in proportion to the overspeed
//
// A landing at downward speed v deals max(0, v - IMPACT_SAFE_SPEED) *
// IMPACT_DAMAGE_RATE (0.1) hull, so an empty terminal-speed plunge at 950
// costs 25 and a loaded one at 1600 costs 90.
//
// Automated validation: pose several landing velocities onto a floor and hold
// each hull loss against the formula.
//
// `test-case.toml` declares this suite as `hazards/impact-damage.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (slam (replay)) around the drive.

import { test } from "vitest";

test("A hard landing costs hull in proportion to the overspeed", () => {
  throw new Error(
    "Deepcore validator `hazards/impact-damage` is declared in test-case.toml but has not been authored yet.",
  );
});
