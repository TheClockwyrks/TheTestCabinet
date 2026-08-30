// Deepcore — assets.miner-fuel-out-cycle. STUB: NOT YET AUTHORED.
//
// The fuel-out cycle is produced with its frames
//
// The fuel-out animation state has a produced cycle at assets/miner/fuel-out/,
// numbered from frame00.png, carrying at least 2 frames, and no two frames of
// it are identical, so the cycle animates rather than repeating one drawing.
// Its content is slumped and powerless, the jetpack dead.
//
// Automated validation: read the frames of assets/miner/fuel-out/, hold the
// count at 2 or more and hold every pair of frames different by a pixel
// comparison.
//
// `test-case.toml` declares this suite as `assets/miner-fuel-out-cycle.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cycle (image)) around the drive.

import { test } from "vitest";

test("The fuel-out cycle is produced with its frames", () => {
  throw new Error(
    "Deepcore validator `assets/miner-fuel-out-cycle` is declared in test-case.toml but has not been authored yet.",
  );
});
