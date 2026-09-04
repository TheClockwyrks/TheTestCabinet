// Meltdown — surge/core-leaks-five-lives: a Core that reaches its exhaust costs five
// lives.
//
// THE RULE. `specs/surge.md`'s leaving table charges a unit that "reached its
// assigned exhaust" "its leak value in lives", and its roster gives the Core a
// Leak of `5`. `specs/waves.md` adds that "Lives lost to a leak never come
// back".
//
// WHAT THIS ITEM IS FOR. The Core is the costliest row in the table:
// `specs/surge.md` calls it "the boss", "worth five lives if it escapes", and
// `5` is the largest leak value in the game — a quarter of a Containment run's
// twenty lives spent on one unit getting through. A flat-life build reads `1`
// here, a build that reused the Hulk's `2` for every heavy type reads `2`, and a
// build that charged the bounty reads `90`.
//
// THE LIVES ARE POSED HIGH ENOUGH TO SPEND. `startRun` opens a Containment run
// on its `20` starting lives (`specs/modes.md`), so five can be charged without
// the run reaching `0` and ending on this frame — which would open the game-over
// screen and put the reading inside a transition this item is not about
// (`specs/waves.md`).
//
// ONE READING, IN ONE DIRECTION: the lives the leak spent. That a leak removes
// the unit as well is `surge/leak-costs-a-life`'s.
//
// HOW THE LEAK IS REACHED. It cannot be posed: `setLives` "triggers no game over:
// the loss belongs to the leak path, and this is a precondition"
// (`specs/instrumentation.md`), and nothing on the surface moves a unit through
// an opening. So the Core is posed one tile short of the right exhaust and covers
// that last tile under its own power (`surge/roster.ts`). Its route is recomputed from the tile it is placed on, and
// a unit entering at the left vent is assigned the right exhaust for its whole
// life (`specs/floor.md`), so the tile it stands on is one step from the opening
// it must leave through.
//
// THE FLOOR IS EMPTY BUT FOR THE LEAKER. With no tower standing there is no
// damage path at all, so the only way the unit can leave the roster is the one
// this item is about — which is what lets the lives be read against a removal
// without asserting anything about what a kill does.
//
// AND THE PHASE IS `building`. A wave clears only while the phase is `wave`
// (`specs/waves.md`), so the leak cannot also clear a wave, pay a clear bonus,
// advance the wave number and open a build phase on top of the one figure being
// read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { SURGE_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { LEAK_FRAMES, poseLeaker, runUntilLeaked } from "./roster";

/** The lives `specs/surge.md` charges for this type's leak. */
const LEAK = SURGE_DEFS.core.leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("charges five lives when a Core reaches its exhaust", async () => {
  await startRun(h);
  await poseLeaker(h, "core");

  const before = (await h.snapshot()).lives;
  const leaked = await runUntilLeaked(h);

  await captureStill(h, "leak");
  const after = await h.snapshot();

  assertTrue(
    leaked,
    `precondition: the Core reached its exhaust and left the floor inside ` +
      `${LEAK_FRAMES} frames`,
  );
  assertEqual(
    before - after.lives,
    LEAK,
    "the lives a leaked Core cost (specs/surge.md)",
  );
});
