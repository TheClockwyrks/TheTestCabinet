// Meltdown — combat/slow-expires: a slow lasts a second and a half.
//
// specs/combat.md: a slow "lasts `SLOW_TIME` (`1.5`) seconds from the moment it is
// applied", and "The timer counts down against the game time each frame advances by.
// When it reaches `0` the slow ends, the factor returns to `0`, and the unit is back
// at its base speed."
//
// THE RIME GOES THE MOMENT ITS SHOT LANDS, and that is what makes this a reading of
// the DURATION rather than of a Rime firing again. Left standing, the Rime would land
// another shot every `0.417` seconds and refresh the timer each time
// (`combat/slow-equal-refreshes`), so the slow would never expire and nothing here
// could be measured. `removeTower(id)` pays no refund and changes neither money nor
// score (specs/instrumentation.md), so what is left on the floor is one unit carrying
// one slow with a clock running on it.
//
// THE DURATION IS BRACKETED, WHICH IS THE ONLY HONEST WAY TO READ A DEADLINE. A
// single reading after `1.5` seconds is passed by a build whose slow lasts a thousand
// seconds if taken early, and by one whose slow lasts a tenth of a second if taken
// late. So the check reads twice: a few frames SHORT of `1.5` seconds the unit must
// still be slowed, and a few frames PAST it the unit must be back at its base speed.
// Between them the pair pins the duration to the window stated below, and a build
// that used `1.0` or `2.0` seconds fails one end or the other.
//
// THE START OF THE WINDOW IS THE FRAME THE SLOW LANDED ON, found by sweeping one
// frame at a time until the unit reports `slowed`. That is the moment specs/combat.md
// counts from, so the window is measured from it rather than from the start of a
// drive whose first shot could fall anywhere inside an interval.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import { SLOW_TIME, SURGE_DEFS } from "../../src/constants";
import {
  captureStill,
  createHarness,
  seconds,
  ticksFor,
  unitById,
  type Harness,
} from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  ticksForShots,
  unitOf,
} from "./duel";

/** The one emitter that slows, at level I, pinned cold so the slow is 0.55. */
const TOWER = "rime";
const LEVEL = 1;
const HEAT = 0;

/** The unit read, and its `baseSpeed` from specs/surge.md. */
const MARK = "mote";
const BASE_SPEED = SURGE_DEFS[MARK].speed;

/**
 * How far either side of `1.5` seconds the two readings are taken, in frames.
 *
 * Six frames is `0.05` seconds of game time, and it is a tolerance rather than
 * geometry: it says how far a build's deadline may sit from the specified one. Two
 * things need the room, and both are a frame wide. The sweep stops on the frame the
 * slow became visible, which is up to one frame after the shot resolved; and a build
 * is free to count the timer down before it resolves its shots or after, which shifts
 * the deadline by a frame the other way. At the suite's 120 Hz that is `0.017`
 * seconds all told, so six frames is three times the room a conformant build can need
 * — and still twenty-five times inside the nearest wrong figure, a slow that lasted
 * one second or two.
 */
const MARGIN_TICKS = 6;

/** How long a shot is waited for: three intervals is generous and bounded. */
const SHOT_INTERVALS = 3;

/**
 * How close the recovered speed must come, as decimal places of a logical unit per
 * second.
 *
 * Three places is `0.0005`. An expired slow returns the unit to its roster figure
 * unchanged, so a conformant build reads `60` exactly; what the bound excludes is a
 * slow that faded partway, the smallest visible fraction of which — a hundredth of
 * the `0.55` this Rime applies — would still hold `0.33` off the speed.
 */
const SPEED_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A slow lasts a second and a half", async () => {
  const gunId = poseGun(h, TOWER, HEAT, LEVEL);
  const mark = poseMarkEast(h, TOWER, MARK, NEAR_UNITS);

  const landed = await h.until(
    (snapshot) => unitById(snapshot, mark)?.slowed === true,
    {
      poll: 1,
      maxFrames: ticksForShots(SHOT_INTERVALS, fireRateOf(TOWER, LEVEL)),
    },
  );
  assertTrue(
    landed.hit,
    `precondition: a cold level-${LEVEL} ${TOWER} landed a slow within ` +
      `${SHOT_INTERVALS} fire intervals`,
  );
  // From here the Rime is gone, so nothing can refresh the timer.
  h.debug.removeTower(gunId);

  await h.advance(ticksFor(SLOW_TIME) - MARGIN_TICKS);
  const early = unitOf(h.snapshot(), mark);

  await h.advance(2 * MARGIN_TICKS);
  captureStill(h, "expired");
  const late = unitOf(h.snapshot(), mark);

  assertEqual(
    early.slowed,
    true,
    `the mark still slowed ${SLOW_TIME - seconds(MARGIN_TICKS)}s after the slow ` +
      `landed, short of the ${SLOW_TIME}s SLOW_TIME`,
  );
  assertEqual(
    late.slowed,
    false,
    `the mark still slowed ${SLOW_TIME + seconds(MARGIN_TICKS)}s after the slow ` +
      `landed, past the ${SLOW_TIME}s SLOW_TIME`,
  );
  assertEqual(
    late.slowFactor,
    0,
    `the slow left on the mark ${SLOW_TIME + seconds(MARGIN_TICKS)}s after it ` +
      `landed`,
  );
  assertCloseTo(
    late.speed,
    BASE_SPEED,
    SPEED_DIGITS,
    `the mark's speed once the slow expired, against baseSpeed ${BASE_SPEED}`,
  );
});
