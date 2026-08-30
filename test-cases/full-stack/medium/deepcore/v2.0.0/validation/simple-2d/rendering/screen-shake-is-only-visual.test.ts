// Deepcore — rendering.screen-shake-is-only-visual. STUB: NOT YET AUTHORED.
//
// The shake never moves the simulation
//
// The screen shake is purely visual: the miner world position, its velocity
// and every cell are exactly what they would be without it, so a blast never
// displaces the game itself.
//
// Automated validation: detonate a posed pocket with travel off and hold the
// miner position and the surrounding cells unchanged through the shake.
//
// `test-case.toml` declares this suite as `rendering/screen-shake-is-only-visual.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behaviour,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (still (replay)) around the drive.

import { test } from "vitest";

test("The shake never moves the simulation", () => {
  throw new Error(
    "Deepcore validator `rendering/screen-shake-is-only-visual` is declared in test-case.toml but has not been authored yet.",
  );
});
