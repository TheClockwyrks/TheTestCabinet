// Deepcore — fuel.thrust-burn-eases. STUB: NOT YET AUTHORED.
//
// A fast climb burns at the cheaper cruise rate
//
// The thrust burn is THRUST_BURN_MAX + (THRUST_BURN_MIN - THRUST_BURN_MAX) *
// min(1, up / CRUISE_SPEED), reaching THRUST_BURN_MIN (2) fuel per second at
// CRUISE_SPEED (900) upward, so a light fast ascent is cheaper per second than
// a slow grinding one.
//
// Automated validation: pose the miner at a known upward velocity with travel
// off, hold thrust for a fixed span at each of several speeds and hold each
// burn against the formula.
//
// `test-case.toml` declares this suite as `fuel/thrust-burn-eases.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cruise (replay)) around the drive.

import { test } from "vitest";

test("A fast climb burns at the cheaper cruise rate", () => {
  throw new Error(
    "Deepcore validator `fuel/thrust-burn-eases` is declared in test-case.toml but has not been authored yet.",
  );
});
