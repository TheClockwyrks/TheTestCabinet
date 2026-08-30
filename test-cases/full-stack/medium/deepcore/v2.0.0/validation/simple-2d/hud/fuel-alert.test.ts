// Deepcore — hud.fuel-alert. STUB: NOT YET AUTHORED.
//
// The fuel gauge takes its alert treatment when low
//
// Below LOW_FUEL_FRACTION (0.2) of the maximum the fuel gauge takes its alert
// treatment, so it is drawn differently from the same gauge above the
// threshold.
//
// Automated validation: read the drawn gauge just above and just below the
// threshold and hold the two frames different.
//
// `test-case.toml` declares this suite as `hud/fuel-alert.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (alert (image)) around the drive.

import { test } from "vitest";

test("The fuel gauge takes its alert treatment when low", () => {
  throw new Error(
    "Deepcore validator `hud/fuel-alert` is declared in test-case.toml but has not been authored yet.",
  );
});
