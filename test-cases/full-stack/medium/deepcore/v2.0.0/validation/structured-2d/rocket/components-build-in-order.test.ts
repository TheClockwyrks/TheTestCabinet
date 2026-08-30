// Deepcore — rocket.components-build-in-order. STUB: NOT YET AUTHORED.
//
// The checklist builds in its stated order
//
// The Launch Pad offers the next uninstalled component in the order Hull
// Frame, Fuel Cells, Guidance Unit, Thruster Assembly then Ignition Core, and
// each becomes available only once the one before it is installed.
//
// Automated validation: read nextComponent at each installed count from 0 to 5
// and hold the sequence against specs/rocket.md.
//
// `test-case.toml` declares this suite as `rocket/components-build-in-order.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (checklist (image)) around the drive.

import { test } from "vitest";

test("The checklist builds in its stated order", () => {
  throw new Error(
    "Deepcore validator `rocket/components-build-in-order` is declared in test-case.toml but has not been authored yet.",
  );
});
