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
// flights run for the same NUMBER OF TICKS, so each has exactly the same
// `TRAIL_TICKS` of history behind it and neither is read mid-fill; and both are
// flown TO the same point of that lane and walked back the same distance, so
// neither reading is clipped where the other is not.

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

/** Long enough that each round has a full TRAIL_TICKS of travel behind it. */
const FLIGHT_TICKS = TRAIL_TICKS + 4;

/**
 * Where BOTH flights are read, and where each therefore has to start.
 *
 * The two rounds are flown TO the same point of the lane rather than FROM the
 * same one, and that is what makes the ratio honest at every drawn length. The
 * walk below runs back a fixed distance from wherever the round stands, so two
 * readings taken at different points of the lane have different amounts of lane
 * behind them — and a build whose tail is a fixed length longer than that walk
 * would then be clipped to two different numbers and could read as a ratio it
 * does not have. Read at one point with one cap, such a build answers the same
 * number twice, which is a ratio of `1`.
 *
 * `900` leaves the slower start at `845` and the faster at `735`, both well
 * inside both seams, and leaves the walk `495` units of lane to run back
 * through.
 */
const END_X = 900;
const SLOW_START_X = END_X - SLOW * FLIGHT_TICKS * TICK_DT;
const FAST_START_X = END_X - FAST * FLIGHT_TICKS * TICK_DT;

/** The travel TRAIL_TICKS covers at each speed: `45` units and `135`. */
const SLOW_SPAN = SLOW * TRAIL_TICKS * TICK_DT;
const FAST_SPAN = FAST * TRAIL_TICKS * TICK_DT;

/**
 * How far back along the lane a reading of the streak walks: ONE distance for
 * both, three times the longer of the two spans.
 *
 * It is ONE distance rather than each flight's own span because a per-flight
 * cap is a ratio of its own: a walk that stopped at each flight's span would
 * answer the span for any tail at least that long, so a build drawing a fixed
 * streak longer than both — `200` units at either speed, say — would be clipped
 * to `45` and `135` and read as a perfect `3` while obeying nothing. Capped at
 * one distance, and read at one point of the lane, that build answers the same
 * number twice, which is a ratio of `1`.
 *
 * THREE TIMES the faster span, so the reading is a conforming tail's real drawn
 * extent and never the cap: `405` units is far past any fade a tail of `135`
 * can have. The walk still stops on the first `GAP` of unlit columns, so
 * nothing beyond the tail is gathered in whatever the cap allows, and `END_X`
 * leaves the whole `405` inside the field.
 *
 * (What bounds an over-long tail in the other direction is
 * `bullets/trail-follows-the-wrap`, which walks the whole band and holds every
 * drawn column to the span; this item's business is only the proportionality.)
 */
const WALK_TO = 3 * FAST_SPAN;

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
      { x: SLOW_START_X, speed: SLOW, ticks: FLIGHT_TICKS },
    );
    const slow = reachAlong(slowRun.map, slowRun.pair, slowRun.round.x, -1, {
      from: FROM,
      to: WALK_TO,
      threshold: LIT,
      gap: GAP,
    } satisfies ReachOptions);

    const fastRun = await trailLane(
      h,
      { y: LANE_Y, halfHeight: LANE_HALF },
      { x: FAST_START_X, speed: FAST, ticks: FLIGHT_TICKS },
    );
    const fast = reachAlong(fastRun.map, fastRun.pair, fastRun.round.x, -1, {
      from: FROM,
      to: WALK_TO,
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
      `(${TRAIL_TICKS}) ticks of motion rather than a fixed distance — ` +
      `${SLOW_SPAN} units at the slower speed and ${FAST_SPAN} at the faster ` +
      `(specs/weapons.md); the two reached ${reaches.slow.toFixed(1)} and ` +
      `${reaches.fast.toFixed(1)} units, read at the same point of the lane ` +
      `and walked back the same ${WALK_TO} units`,
  );
});
