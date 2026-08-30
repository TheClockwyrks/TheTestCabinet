// Deepcore — hazards.gas-damage-scales-with-depth. STUB: NOT YET AUTHORED.
//
// A deeper gas pocket hits harder
//
// A detonation at depth fraction f deals GAS_DAMAGE_MIN + (GAS_DAMAGE_MAX -
// GAS_DAMAGE_MIN) * max(0, f - 0.25) / 0.75 hull, so it is 60 where gas first
// appears and 400 at the deepest minable row.
//
// Automated validation: pose a gas pocket at several depth fractions with a
// hull large enough to survive each, detonate and hold each hull loss against
// the formula.
//
// `test-case.toml` declares this suite as `hazards/gas-damage-scales-with-depth.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (deep (replay)) around the drive.

import { test } from "vitest";

test("A deeper gas pocket hits harder", () => {
  throw new Error(
    "Deepcore validator `hazards/gas-damage-scales-with-depth` is declared in test-case.toml but has not been authored yet.",
  );
});
