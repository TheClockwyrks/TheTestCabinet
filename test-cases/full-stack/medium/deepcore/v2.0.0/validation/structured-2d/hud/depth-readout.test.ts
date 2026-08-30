// Deepcore — hud.depth-readout. STUB: NOT YET AUTHORED.
//
// The status bar reads the depth in meters
//
// The depth in meters is drawn on the status bar and follows the miner,
// matching depthMeters.
//
// Automated validation: pose the miner at several depths and read each figure
// off the drawn status bar against depthMeters.
//
// `test-case.toml` declares this suite as `hud/depth-readout.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (depth (image)) around the drive.

import { test } from "vitest";

test("The status bar reads the depth in meters", () => {
  throw new Error(
    "Deepcore validator `hud/depth-readout` is declared in test-case.toml but has not been authored yet.",
  );
});
