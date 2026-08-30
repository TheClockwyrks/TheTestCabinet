// Deepcore — rendering.screen-shake. STUB: NOT YET AUTHORED.
//
// A blast shakes the screen
//
// A gas detonation, an explosives blast, a hard landing and a Core Sample
// detonation each jitter the drawn world briefly and the jitter decays out, so
// the frames just after a blast are displaced from the frames before it.
//
// Automated validation: detonate a posed pocket with the miner held in place
// and compare the drawn world before, just after and well after the blast,
// holding a displacement that decays.
//
// `test-case.toml` declares this suite as `rendering/screen-shake.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (shake (replay)) around the drive.

import { test } from "vitest";

test("A blast shakes the screen", () => {
  throw new Error(
    "Deepcore validator `rendering/screen-shake` is declared in test-case.toml but has not been authored yet.",
  );
});
