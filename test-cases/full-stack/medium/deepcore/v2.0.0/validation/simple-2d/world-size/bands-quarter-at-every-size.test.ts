// Deepcore — world-size.bands-quarter-at-every-size. STUB: NOT YET AUTHORED.
//
// The four bands quarter the mine at every size
//
// The bands divide the minable rows into four equal parts at every size, so
// the band of a row follows depthFraction rather than a fixed row number and a
// Quick mine has the same shape as a Marathon one.
//
// Automated validation: read tileAt band at the quarter boundaries at each
// size and hold each against the band the depth fraction gives.
//
// `test-case.toml` declares this suite as `world-size/bands-quarter-at-every-size.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (bands (image)) around the drive.

import { test } from "vitest";

test("The four bands quarter the mine at every size", () => {
  throw new Error(
    "Deepcore validator `world-size/bands-quarter-at-every-size` is declared in test-case.toml but has not been authored yet.",
  );
});
