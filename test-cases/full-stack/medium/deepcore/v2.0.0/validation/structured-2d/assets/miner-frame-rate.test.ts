// Deepcore — assets.miner-frame-rate. STUB: NOT YET AUTHORED.
//
// The miner cycle advances at its stated rate
//
// The drawn miner frame advances at ANIM_FPS (12) frames per second while a
// state holds, so a cycle of four frames takes a third of a second to run
// once.
//
// Automated validation: hold the miner in one state and sample the drawn frame
// each sixtieth of a second, holding the frame changes against ANIM_FPS.
//
// `test-case.toml` declares this suite as `assets/miner-frame-rate.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (cycle (replay)) around the drive.

import { test } from "vitest";

test("The miner cycle advances at its stated rate", () => {
  throw new Error(
    "Deepcore validator `assets/miner-frame-rate` is declared in test-case.toml but has not been authored yet.",
  );
});
