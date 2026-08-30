// Deepcore — assets.miner-hurt-cycle. STUB: NOT YET AUTHORED.
//
// The hurt cycle is produced with its frames
//
// The hurt animation state has a produced cycle at assets/miner/hurt/,
// numbered from frame00.png, carrying at least 2 frames, and no two frames of
// it are identical, so the cycle animates rather than repeating one drawing.
// Its content is a sharp flinch and recoil at the instant of damage.
//
// Automated validation: read the frames of assets/miner/hurt/, hold the count
// at 2 or more and hold every pair of frames different by a pixel comparison.
//
// `test-case.toml` declares this suite as `assets/miner-hurt-cycle.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cycle (image)) around the drive.

import { test } from "vitest";

test("The hurt cycle is produced with its frames", () => {
  throw new Error(
    "Deepcore validator `assets/miner-hurt-cycle` is declared in test-case.toml but has not been authored yet.",
  );
});
