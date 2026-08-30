// Deepcore — fuel.thrust-burn-at-rest. STUB: NOT YET AUTHORED.
//
// Lift-off burns at the full thrust rate
//
// Thrust held at zero upward speed burns THRUST_BURN_MAX (5) fuel per second
// at the Standard world size, so lifting off from a stop is the most expensive
// part of a climb.
//
// Automated validation: pose the miner at rest with travel off so its speed
// stays zero, hold thrust for a fixed span and hold the fuel spent against
// THRUST_BURN_MAX times the span.
//
// `test-case.toml` declares this suite as `fuel/thrust-burn-at-rest.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (liftoff (replay)) around the drive.

import { test } from "vitest";

test("Lift-off burns at the full thrust rate", () => {
  throw new Error(
    "Deepcore validator `fuel/thrust-burn-at-rest` is declared in test-case.toml but has not been authored yet.",
  );
});
