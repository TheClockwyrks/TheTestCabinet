// Deepcore — assets.miner-idle-cycle. STUB: NOT YET AUTHORED.
//
// The idle cycle is produced with its frames
//
// The idle animation state has a produced cycle at assets/miner/idle/,
// numbered from frame00.png, carrying at least 2 frames, and no two frames of
// it are identical, so the cycle animates rather than repeating one drawing.
// Its content is standing at rest, with a breathing bob and a lamp flicker.
//
// Automated validation: read the frames of assets/miner/idle/, hold the count
// at 2 or more and hold every pair of frames different by a pixel comparison.
//
// `test-case.toml` declares this suite as `assets/miner-idle-cycle.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cycle (image)) around the drive.

import { test } from "vitest";

test("The idle cycle is produced with its frames", () => {
  throw new Error(
    "Deepcore validator `assets/miner-idle-cycle` is declared in test-case.toml but has not been authored yet.",
  );
});
