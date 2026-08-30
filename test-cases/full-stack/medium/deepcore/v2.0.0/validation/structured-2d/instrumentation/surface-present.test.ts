// Deepcore — instrumentation.surface-present. STUB: NOT YET AUTHORED.
//
// The debug and automation surface is present
//
// Every operation specs/instrumentation.md names is present as a function on
// the surface, reached on the page as window.__deepcore in an engineless build
// and off engine.debug in an engine build, and the surface is live: setTile
// poses a cell, tileAt reads that cell back, setMinerPosition moves the miner,
// and both the snapshot and the drawn frame change to match.
//
// Automated validation: reflect that every required operation is installed as
// a function (setAutoStep, advance, keyDown, keyUp, press and setMuted under
// none alone), then prove liveness by posing a cell and the miner and reading
// the snapshot and the canvas back.
//
// `test-case.toml` declares this suite as `instrumentation/surface-present.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (state (image)) around the drive.

import { test } from "vitest";

test("The debug and automation surface is present", () => {
  throw new Error(
    "Deepcore validator `instrumentation/surface-present` is declared in test-case.toml but has not been authored yet.",
  );
});
