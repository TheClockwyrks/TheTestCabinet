// bullets/trail-length-scales-with-speed — the tail is a slice of TIME, not of
// distance.
//
// specs/weapons.md, "The bullet trail": the tail "spans a fixed slice of recent
// travel, the last `TRAIL_TICKS` (`18`) ticks of the bullet's motion, so its
// drawn length is proportional to the bullet's current speed." That last clause
// is the whole of this item: a tail of a FIXED drawn length, however pretty, does
// not say how the well is bending a shot, and a tail whose length is a fixed
// number of screen units reads the same behind a round crawling out of the well
// as behind one falling into it.
//
// WHAT IS READ. The same round flown down the same empty lane twice, once at
// `300` units per second and once at `900`, with the drawn streak behind it
// measured each time against the same seeded flight without the round (lane.ts
// sets out why the control is a second flight rather than a second reading). The
// verdict is the RATIO of the two, held against the `3` their speeds fix, within
// the 25 percent the review item states.
//
// WHY A RATIO RATHER THAN TWO LENGTHS. Because the specification fixes no palette
// and has the tail "fading to nothing at its oldest end", the drawn extent of a
// conforming tail is some fraction of its geometric span, and the fraction is the
// build's own styling. That fraction is the SAME at both speeds — the fade runs
// over the tail's own length whatever that length is — so it cancels in the
// ratio, and what is left is the proportionality the rule states. A build whose
// tail is a fixed drawn length reads `1`; a build spanning a fixed DISTANCE of
// the path rather than a slice of time reads `1`; a build spanning a fixed number
// of ticks reads `3`. The bound admits `2.25` to `3.75`, and nothing else.
//
// THE SLOW READING IS REQUIRED TO EXIST BEFORE THE RATIO IS TAKEN, and the
// failure says so: a build that drew no tail at all has nothing to divide, and
// `bullets/trail-drawn` is the item that names that fault. It fails here too,
// because a build with no tail cannot show a tail scaling.
//
// WHAT THE CLIP HOLDS. Four flights, in pairs: each speed is flown once with the
// round and once without, because the reading is a difference against the second
// (lane.ts). A reviewer therefore sees each trail beside the bare lane it was
// measured against, and the clip runs on past the second reading rather than
// cutting on the frame the verdict was taken from.
//
// THE LANE IS THE BOTTOM OF THE FIELD, `330` units below the star, so no part of
// the star — nothing of which is drawn beyond `180` units (specs/field.md) —
// reaches the band, and `startPlaying` leaves no rock and no saucer on it. Both
// flights are stopped at the same TICK COUNT rather than at the same distance, so
// each has exactly the same `TRAIL_TICKS` of history behind it and neither is
// read mid-fill.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_R, TICK_DT, TRAIL_TICKS } from "../../src/constants";
import { assertBetween, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { reachAlong, trailLane, type ReachOptions } from "./lane";

/** The lane both rounds are flown along, and how deep the band read along it is. */
const LANE_Y = 690;
const LANE_HALF = 4;

/** The two speeds the review item names, and the ratio they fix. */
const SLOW = 300;
const FAST = 900;
const RATIO = FAST / SLOW;

/** Where each round starts: far enough back that neither reaches the seam. */
const START_X = 200;

/** Long enough that each round has a full TRAIL_TICKS of travel behind it. */
const FLIGHT_TICKS = TRAIL_TICKS + 4;

/** The travel TRAIL_TICKS covers at each speed. */
const SLOW_SPAN = SLOW * TRAIL_TICKS * TICK_DT;
const FAST_SPAN = FAST * TRAIL_TICKS * TICK_DT;

/** How far a device column must move from the bare frame to count as drawn. */
const LIT = 5;

/**
 * The widest unlit run a streak may contain and still be one streak, in units.
 *
 * A tail drawn sample by sample puts its samples one tick of travel apart, which
 * at the faster of the two speeds is `7.5` units; twelve is more than that and a
 * ninth of the faster span, so it cannot manufacture a reach at either speed.
 */
const GAP = 12;

/** Where a reading of the streak starts, clear of the round's own disc. */
const FROM = BULLET_R + 3;

/** The ticks of flight the replay keeps after the second reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.2);

/** How far the measured ratio may fall from `3`: the review item's 25 percent. */
const RATIO_TOLERANCE = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a tail three times as long behind a round travelling three times as fast", async () => {
  const reaches = await captureReplay(h, "trails", async () => {
    const slowRun = await trailLane(
      h,
      { y: LANE_Y, halfHeight: LANE_HALF },
      { x: START_X, speed: SLOW, ticks: FLIGHT_TICKS },
    );
    const slow = reachAlong(h, slowRun.pair, slowRun.round.x, -1, {
      from: FROM,
      to: SLOW_SPAN,
      threshold: LIT,
      gap: GAP,
    } satisfies ReachOptions);

    const fastRun = await trailLane(
      h,
      { y: LANE_Y, halfHeight: LANE_HALF },
      { x: START_X, speed: FAST, ticks: FLIGHT_TICKS },
    );
    const fast = reachAlong(h, fastRun.pair, fastRun.round.x, -1, {
      from: FROM,
      to: FAST_SPAN,
      threshold: LIT,
      gap: GAP,
    } satisfies ReachOptions);

    // The readings are taken off the bands already read, so these ticks change
    // no verdict: they are here so the clip ends on the two rounds flying rather
    // than on the frame the second was measured on.
    await h.advance(AFTERMATH_TICKS);
    return { slow, fast };
  });

  assertGreaterThan(
    reaches.slow,
    0,
    `a drawn tail behind the round at ${SLOW} units per second, which is what ` +
      `the faster tail is measured against (specs/weapons.md; ` +
      `bullets/trail-drawn is the item about a tail existing at all)`,
  );
  assertBetween(
    reaches.fast / reaches.slow,
    RATIO * (1 - RATIO_TOLERANCE),
    RATIO * (1 + RATIO_TOLERANCE),
    `the drawn tail at ${FAST} units per second longer than the one at ` +
      `${SLOW} in the ratio of their speeds (${RATIO}), within ` +
      `${RATIO_TOLERANCE * 100} percent, because the tail spans TRAIL_TICKS ` +
      `(${TRAIL_TICKS}) ticks of motion rather than a fixed distance ` +
      `(specs/weapons.md); the two reached ${reaches.slow.toFixed(1)} and ` +
      `${reaches.fast.toFixed(1)} units`,
  );
});
