// Meltdown — surge/leak-costs-a-life: a Mote that reaches its exhaust costs one
// life.
//
// THE RULE. `specs/surge.md`'s leaving table charges a unit that "reached its
// assigned exhaust" "its leak value in lives", and its roster gives the Mote a
// Leak of `1`. `specs/waves.md` adds that "Lives lost to a leak never come
// back".
//
// TWO THINGS HAPPEN, AND BOTH ARE READ. `specs/surge.md` removes the unit from
// the floor on the frame it reaches its exhaust AND charges its leak value. A
// build that charges the life and leaves the unit walking on through the casing
// would pass a check that read only the lives; a build that removes it silently
// and charges nothing would pass a check that read only the roster. So the count
// on the floor and the lives are asserted together, and this is the one item in
// the group that reads the removal a leak carries.
//
// THE MOTE IS THE BASELINE ROW, whose leak is the `1` five of the six types
// share, so a build that charged a flat life for every leak passes here and is
// named by `surge/hulk-leaks-two-lives` and `surge/core-leaks-five-lives`
// instead. This item decides that a leak costs a life at all.
//
// HOW THE LEAK IS REACHED. It cannot be posed: `setLives` "triggers no game over:
// the loss belongs to the leak path, and this is a precondition"
// (`specs/instrumentation.md`), and nothing on the surface moves a unit through
// an opening. So the Mote is posed one tile short of the right exhaust and covers
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
const LEAK = SURGE_DEFS.mote.leak;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("removes one life and the Mote itself when the Mote reaches its exhaust", async () => {
  await startRun(h);
  await poseLeaker(h, "mote");

  const before = (await h.snapshot()).lives;
  const leaked = await runUntilLeaked(h);

  await captureStill(h, "leak");
  const after = await h.snapshot();

  assertTrue(
    leaked,
    `precondition: the Mote reached its exhaust and left the floor inside ` +
      `${LEAK_FRAMES} frames`,
  );
  assertEqual(
    after.surge.length,
    0,
    "units still on the floor after the Mote reached its exhaust: a leak " +
      "removes the unit as well as charging for it (specs/surge.md)",
  );
  assertEqual(
    before - after.lives,
    LEAK,
    "the lives a leaked Mote cost (specs/surge.md)",
  );
});
