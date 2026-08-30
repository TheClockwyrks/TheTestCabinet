// Deepcore — fuel.no-free-refuel. STUB: NOT YET AUTHORED.
//
// Fuel never refills on its own
//
// Fuel never refills on its own anywhere, the camp included, so arriving at
// the surface leaves the tank exactly as the climb left it and the Fuel Depot
// is the only way to fill it.
//
// Automated validation: pose a part-empty tank, stand the miner in the camp
// for a long span and read the fuel unchanged.
//
// `test-case.toml` declares this suite as `fuel/no-free-refuel.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (tank (replay)) around the drive.

import { test } from "vitest";

test("Fuel never refills on its own", () => {
  throw new Error(
    "Deepcore validator `fuel/no-free-refuel` is declared in test-case.toml but has not been authored yet.",
  );
});
