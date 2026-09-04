// torpedo/lifetime — a torpedo that hits nothing is removed after 3.5 seconds.
//
// specs/weapons.md, "The flight": the Lifetime row is `TORPEDO_LIFE` (`3.5`
// seconds), "after which a torpedo that has hit nothing is removed".
//
// TWO READINGS, ONE EITHER SIDE OF THE FIGURE. At `3.4` seconds of game time the
// torpedo is still in flight; at `3.6` it is gone. A build with no lifetime at all
// fails the second, one that expires early — at three seconds, or at the gun's
// `BULLET_LIFE` (`1.5`) — fails the first, and one that expires at `3.5` passes
// both. Reading only the second would score a build that removed it on the tick
// after the pose.
//
// A HUNDREDTH OF THE FIGURE EITHER SIDE. `3.4` and `3.6` are the manifest's own
// stations: `12` ticks of the `TICK_HZ` (`120`) clock specs/simulation.md fixes
// from `3.5` in each direction, which is the honest floor for a clock counted in
// whole ticks, and a twenty-ninth of the figure being read.
//
// IT MUST HIT NOTHING, AND THE FIELD IS POSED SO IT CANNOT. `startPlaying` leaves
// no rock, no saucer and no enemy fire and shuts both world gates, so nothing
// arrives over the three and a half seconds; the lane is the bottom of the field,
// `330` units below the star's row, so the core never absorbs it (they touch at
// `36`, specs/collision.md); and the guidance is off, which is the faculty this
// requirement does not exercise. The torpedo covers `1470` units over its life and
// so crosses a seam, which specs/weapons.md makes a thing that carries it on rather
// than removes it — `wraps` is the item that decides that.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { TORPEDO_LIFE } from "../constants";
import {
  captureStill,
  createHarness,
  poseTorpedo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { HEADING_RIGHT, LANE_Y, torpedoRoster } from "./scene";

/** Where the flight begins: the left of the bottom lane (see `scene.ts`). */
const FROM_X = 140;

/** The station before the figure: `0.1` s short of `TORPEDO_LIFE`. */
const ALIVE_AT = TORPEDO_LIFE - 0.1;

/** The station past it: `0.1` s beyond. */
const GONE_AT = TORPEDO_LIFE + 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("is still in flight at 3.4 seconds and gone by 3.6", async () => {
  await startPlaying(h);
  await poseTorpedo(h, FROM_X, LANE_Y, HEADING_RIGHT, { homing: false });

  await h.skip(ticksFor(ALIVE_AT));
  const alive = await h.snapshot();

  await h.skip(ticksFor(GONE_AT) - ticksFor(ALIVE_AT));
  const gone = await h.snapshot();
  // The field the instant after the torpedo expired.
  await captureStill(h, "expiry");

  assertLength(
    torpedoRoster(alive, `${ALIVE_AT} seconds after the pose`),
    1,
    `the torpedo still in flight ${ALIVE_AT} s after it was put up, a tenth of ` +
      `a second short of the TORPEDO_LIFE (${TORPEDO_LIFE} s) specs/weapons.md ` +
      `gives it, on a field it can hit nothing on`,
  );
  assertLength(
    torpedoRoster(gone, `${GONE_AT} seconds after the pose`),
    0,
    `the torpedo removed ${GONE_AT} s after it was put up, a tenth of a second ` +
      `past its TORPEDO_LIFE (${TORPEDO_LIFE} s), having hit nothing ` +
      `(specs/weapons.md)`,
  );
});
