// Meltdown — surge/hulk-leaks-two-lives: a Hulk that reaches its exhaust costs two
// lives.
//
// THE RULE. `specs/surge.md`'s leaving table charges a unit that "reached its
// assigned exhaust" "its leak value in lives", and its roster gives the Hulk a
// Leak of `2`. `specs/waves.md` adds that "Lives lost to a leak never come
// back".
//
// WHAT THIS ITEM IS FOR, AND WHY IT IS NOT THE MOTE'S AGAIN. Five of the six
// rows charge `1`, so a build that charged a flat life for every leak is
// indistinguishable from a conformant one on all five. The Hulk is one of the
// two rows that is not `1`: `specs/surge.md` says it "costs two lives if it
// escapes". A flat-life build reads `1` here, a build that charged the bounty
// instead reads `7`, and a build that reads the column reads `2`.
//
// ONE READING, IN ONE DIRECTION: the lives the leak spent. That a leak removes
// the unit as well is `surge/leak-costs-a-life`'s, and it is not asserted again
// here, so a build with a working removal and a wrong charge grades differently
// from one with both broken.
//
// HOW THE LEAK IS REACHED. It cannot be posed: `setLives` "triggers no game over:
// the loss belongs to the leak path, and this is a precondition"
// (`specs/instrumentation.md`), and nothing on the surface moves a unit through
// an opening. So the Hulk is posed one tile short of the right exhaust and covers
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
const LEAK = SURGE_DEFS.hulk.leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("charges two lives when a Hulk reaches its exhaust", async () => {
  await startRun(h);
  await poseLeaker(h, "hulk");

  const before = (await h.snapshot()).lives;
  const leaked = await runUntilLeaked(h);

  await captureStill(h, "leak");
  const after = await h.snapshot();

  assertTrue(
    leaked,
    `precondition: the Hulk reached its exhaust and left the floor inside ` +
      `${LEAK_FRAMES} frames`,
  );
  assertEqual(
    before - after.lives,
    LEAK,
    "the lives a leaked Hulk cost (specs/surge.md)",
  );
});
