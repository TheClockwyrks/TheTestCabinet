// Deepcore — assets.miner-walk-cycle. STUB: NOT YET AUTHORED.
//
// The walk cycle is produced with its frames
//
// The walk animation state has a produced cycle at assets/miner/walk/,
// numbered from frame00.png, carrying at least 4 frames, and no two frames of
// it are identical, so the cycle animates rather than repeating one drawing.
// Its content is a readable walk on the ground, legs and drill swinging.
//
// Automated validation: read the frames of assets/miner/walk/, hold the count
// at 4 or more and hold every pair of frames different by a pixel comparison.
//
// `test-case.toml` declares this suite as `assets/miner-walk-cycle.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cycle (image)) around the drive.

import { test } from "vitest";

test("The walk cycle is produced with its frames", () => {
  throw new Error(
    "Deepcore validator `assets/miner-walk-cycle` is declared in test-case.toml but has not been authored yet.",
  );
});
