// Deepcore — assets.miner-jetpack-cycle. STUB: NOT YET AUTHORED.
//
// The jetpack cycle is produced with its frames
//
// The jetpack animation state has a produced cycle at assets/miner/jetpack/,
// numbered from frame00.png, carrying at least 3 frames, and no two frames of
// it are identical, so the cycle animates rather than repeating one drawing.
// Its content is thrusting, the body lifted, the flame flickering at the
// nozzle.
//
// Automated validation: read the frames of assets/miner/jetpack/, hold the
// count at 3 or more and hold every pair of frames different by a pixel
// comparison.
//
// `test-case.toml` declares this suite as `assets/miner-jetpack-cycle.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cycle (image)) around the drive.

import { test } from "vitest";

test("The jetpack cycle is produced with its frames", () => {
  throw new Error(
    "Deepcore validator `assets/miner-jetpack-cycle` is declared in test-case.toml but has not been authored yet.",
  );
});
