// bullets/trail-length-scales-with-speed — the tail is a slice of time, not of
// distance.
//
// specs/weapons.md, "The bullet trail": the tail "spans a fixed slice of recent
// travel, the last `TRAIL_TICKS` (`18`) ticks of the bullet's motion, so its
// drawn length is proportional to the bullet's current speed." A fixed WINDOW of
// time, which is not the same rule as a fixed length: a build that draws a tail
// of some constant number of units satisfies "a fading tail traces its recent
// path" and violates this, and it is the only item in the group that separates
// the two.
//
// WHAT IS READ. How far behind each of two rounds the build painted anything at
// all — one flying at `300` units per second and one at `900` — and the ratio of
// those two reaches, against the `3` the speeds are in. A ratio rather than two
// lengths, because the specification does not say how far along its span a tail
// has faded to nothing, so its absolute reach is a build's own alpha curve. That
// curve cancels: whatever fraction of its span a build's tail is still visible
// over, it is the same fraction at both speeds, and the ratio of the reaches is
// the ratio of the spans. A build drawing a fixed length reads `1`; a build
// drawing a span of fixed distance-per-unit-speed-squared reads `9`.
//
// THE BOUND IS 25 PERCENT, which is the review item's figure, and it is wide on
// purpose: the reach is read off a threshold crossing on a tapering stroke, and
// the two crossings land a device pixel or two either side of the same fraction.
// A quarter of `3` is `0.75`, so the band is `2.25` to `3.75` — nowhere near
// either the `1` a distance-based tail reads or the `9` of the other obvious
// wrong law.
//
// THE CONTROL IS THE SAME CANVAS WITHOUT THE ROUND, taken for each run with
// nothing advanced between the two readings, exactly as `trail-drawn` takes it
// and for the same reason: specs/overview.md fixes no palette, so the only thing
// a painted tail can honestly be held against is the same picture without it.
//
// THE LANE IS THE STAR'S OWN ROW. specs/gravity.md gives a bullet on `y = 360` no
// vertical pull at all, so both rounds hold the row exactly and the reach really
// is measured along the line each one travelled. Both flights stay west of
// `x = 305`, two hundred units clear of everything specs/field.md lets the star
// draw.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan } from "../assert";
import { STAR_Y, TICK_DT, TRAIL_TICKS } from "../constants";
import {
  captureReplay,
  createHarness,
  poseBullet,
  requireBullet,
  startPlaying,
  type Harness,
} from "../harness";
import { bulletLane, changedColumns, laneX } from "./lane";

/** The lane both rounds are flown along, and where on it each flight begins. */
const LANE_Y = STAR_Y;
const START_X = 120;

/** The two speeds compared, in units per second. */
const SLOW = 300;
const FAST = 900;

/** How long each round is flown for: a full trail's worth of history, and some. */
const RUN_TICKS = TRAIL_TICKS + 6;

/**
 * How far behind a round the reach is looked for, in logical units.
 *
 * `260`, which is nearly twice the `135` units `TRAIL_TICKS` covers at the faster
 * speed, so a build drawing the full span is measured rather than clipped, and
 * still short enough that the window ends inside the field on both flights.
 */
const SEARCH_BACK = 260;

/** How far the canvas must move for a column to count as painted, out of 255. */
const DISTINCT_MIN = 12;

/** The ratio the spans are in, and how far the reading may fall from it. */
const DUE_RATIO = FAST / SLOW;
const RATIO_TOLERANCE = 0.25 * DUE_RATIO;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a tail three times as long behind a round travelling three times as fast", async () => {
  await startPlaying(h);

  const reaches = await captureReplay(h, "trails", async () => {
    const measured: Record<string, number> = {};
    for (const speed of [SLOW, FAST]) {
      const id = await poseBullet(h, START_X, LANE_Y, speed, 0);
      await h.advance(RUN_TICKS);
      const flying = requireBullet(
        await h.snapshot(),
        id,
        `the round flown at ${speed} units per second`,
      );
      const lane = await bulletLane(h, LANE_Y, id);

      let reach = 0;
      for (const column of changedColumns(
        lane.bare,
        lane.drawn,
        DISTINCT_MIN,
      )) {
        const behind = flying.x - laneX(h, column);
        if (behind >= 0 && behind <= SEARCH_BACK) {
          reach = Math.max(reach, behind);
        }
      }
      measured[String(speed)] = reach;
    }
    return measured;
  });

  const slow = reaches[String(SLOW)];
  const fast = reaches[String(FAST)];

  assertGreaterThan(
    slow,
    0,
    `something painted behind the round travelling at ${SLOW} units per ` +
      `second, so the two reaches can be compared at all (specs/weapons.md: a ` +
      `fading tail traces the bullet's recent path)`,
  );
  assertBetween(
    fast / slow,
    DUE_RATIO - RATIO_TOLERANCE,
    DUE_RATIO + RATIO_TOLERANCE,
    `the drawn tail behind a round at ${FAST} units per second longer than ` +
      `the one behind a round at ${SLOW} in the ratio of their speeds ` +
      `(${DUE_RATIO}), because the tail spans TRAIL_TICKS ` +
      `(${TRAIL_TICKS}) ticks of travel rather than a fixed distance ` +
      `(specs/weapons.md); measured as ${fast.toFixed(1)} units against ` +
      `${slow.toFixed(1)}, over the ${(SLOW * TRAIL_TICKS * TICK_DT).toFixed(0)} ` +
      `and ${(FAST * TRAIL_TICKS * TICK_DT).toFixed(0)} units those ticks cover`,
  );
});
