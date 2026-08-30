// Deepcore — hud.cargo-readout. STUB: NOT YET AUTHORED.
//
// The cargo reads slots used over capacity with the load
//
// The status bar reads the slots used over the capacity with the load in
// kilograms alongside, so how full the bay is and how heavy it is are both on
// screen.
//
// Automated validation: pose a known bay and read both figures off the drawn
// status bar.
//
// `test-case.toml` declares this suite as `hud/cargo-readout.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cargo (image)) around the drive.

import { test } from "vitest";

test("The cargo reads slots used over capacity with the load", () => {
  throw new Error(
    "Deepcore validator `hud/cargo-readout` is declared in test-case.toml but has not been authored yet.",
  );
});
