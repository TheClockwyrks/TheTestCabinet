// Deepcore — instrumentation.reset. STUB: NOT YET AUTHORED.
//
// reset returns the game to its title-screen values
//
// After an expedition has dirtied Credits, tiers, cargo, satchel, supplies,
// rocket progress and the mine, reset({seed: 7}) restores the title screen
// with menuIndex 0, mode standard, world size standard, an empty mine, the
// miner on the camp ground at SPAWN_COL facing east at rest, tier 1 on every
// track, full fuel and hull, 0 Credits, nothing held, no live Core Sample,
// neither notice fired, camera lead 0, both faculties running and simTime 0,
// and leaves muted untouched.
//
// Automated validation: dirty every field reset restores, then reset and hold
// the whole state against the title-state list in specs/instrumentation.md,
// checking muted separately.
//
// `test-case.toml` declares this suite as `instrumentation/reset.test.ts` and requires it
// under every engine. Replace this stub with the real suite: pose an isolated
// world through the debug surface `specs/instrumentation.md` fixes, give the
// miner only the faculties this requirement exercises, drive the one behavior,
// assert against the figure the specification states through `assert.ts`, and
// capture the declared output (title (image)) around the drive.

import { test } from "vitest";

test("reset returns the game to its title-screen values", () => {
  throw new Error(
    "Deepcore validator `instrumentation/reset` is declared in test-case.toml but has not been authored yet.",
  );
});
