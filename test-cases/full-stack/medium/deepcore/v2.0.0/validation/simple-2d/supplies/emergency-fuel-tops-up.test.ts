// Deepcore — supplies.emergency-fuel-tops-up. STUB: NOT YET AUTHORED.
//
// Emergency Fuel adds a fixed amount of fuel
//
// Using Emergency Fuel adds EMERGENCY_FUEL (30) fuel, capped at the maximum so
// it never overfills.
//
// Automated validation: use emergency fuel at a low tank and again within 30
// of the maximum, holding the gain and the cap at each.
//
// `test-case.toml` declares this suite as `supplies/emergency-fuel-tops-up.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (field-fuel (image)) around the drive.

import { test } from "vitest";

test("Emergency Fuel adds a fixed amount of fuel", () => {
  throw new Error(
    "Deepcore validator `supplies/emergency-fuel-tops-up` is declared in test-case.toml but has not been authored yet.",
  );
});
