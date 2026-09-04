// Shatter — saucer/weave-speed: every vertical velocity the weave takes IS the
// stated one, in both directions.
//
// THE RULE, AND IT IS AN EQUALITY. specs/saucer.md: at every reroll the saucer
// "sets its vertical velocity to `SAUCER_WEAVE_SPEED` (`90`) directed opposite the
// vertical direction it is travelling in at that moment". `90` is the only vertical
// figure the specification puts on the saucer anywhere — the steering that keeps it
// clear of the core is left to the build, but the weave's speed is fixed — and
// nothing between two rerolls touches the vertical velocity again. So once the
// weave has run, the magnitude of the vertical velocity is `90` at every moment,
// and this item decides that figure in BOTH directions.
//
// A CEILING ALONE WOULD NOT DECIDE IT. A build weaving at five units per second is
// under a ceiling of `90` at every sample, changes sign at every reroll, and rerolls
// on the stated interval — so it would pass this item, `weaves-vertically` and
// `weave-interval` alike, and the one figure the specification states about the
// weave would be decided by nothing. That is why the reading below is of every
// sample against a band rather than of the largest against a bound.
//
// THE FIRST INTERVAL IS NOT READ, because the specification does not put the figure
// there: a saucer "enters with no vertical component" and rerolls "starting one full
// interval after it enters", so the vertical velocity is legitimately zero until the
// first reroll. Readings begin one sample after that interval has run, which leaves
// a build a whole sample of slack over exactly when in the tick it applies the
// reroll.
//
// ONE REQUIREMENT ONLY. That the weave reverses is `weaves-vertically`'s and how
// often it rerolls is `weave-interval`'s. This one says what the speed is, so a
// build with a broken weave grades against exactly one of the three.
//
// TRAVEL IS OFF AND THE GUN IS OFF, for the reasons `weaves-vertically` states, and
// `(240, 620)` is `443` units from the star so the steering never runs. That matters
// more here than anywhere else in the group: the specification lets a build steer
// around the core however it likes, and a vertical speed taken to get out of the
// core's way is not a vertical speed the weave chose.
//
// WHY FIVE PERCENT. `4.5` units per second either side of `90`, and the item's own
// figure. A conformant build sets the figure exactly, so nothing conformant needs
// any of it; what it leaves room for is a build that reaches the figure over a tick
// rather than in one step. A build weaving at `120` is over by a third, and one
// weaving at `45` is under by half.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, fail } from "../assert";
import { SAUCER_WEAVE_INTERVAL, SAUCER_WEAVE_SPEED } from "../constants";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the saucer stands: far from the star, so only the weave decides. */
const STAND = { x: 240, y: 620 };

/** The five weave intervals every value is read over. */
const WATCH_TICKS = ticksFor(5 * SAUCER_WEAVE_INTERVAL);

/** How often the vertical velocity is read: every twentieth of a second. */
const SAMPLE_TICKS = 6;

/**
 * The ticks that pass before a reading counts.
 *
 * One full weave interval, which the specification leaves the saucer with no
 * vertical component over, plus one sample of slack for where in the tick a build
 * applies the reroll.
 */
const SETTLE_TICKS = ticksFor(SAUCER_WEAVE_INTERVAL) + SAMPLE_TICKS;

/** Five percent of `SAUCER_WEAVE_SPEED`: `4.5` units per second. See the header. */
const SPEED_TOLERANCE = SAUCER_WEAVE_SPEED * 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds every vertical velocity the weave takes at SAUCER_WEAVE_SPEED", async () => {
  await startPlaying(h);
  await poseSaucer(h, STAND.x, STAND.y, {
    vx: 0,
    vy: 0,
    mind: true,
    gun: false,
    travel: false,
  });

  let fastest = 0;
  const read: { tick: number; vy: number }[] = [];
  for (let run = 0; run < WATCH_TICKS; run += SAMPLE_TICKS) {
    const step = Math.min(SAMPLE_TICKS, WATCH_TICKS - run);
    await h.advance(step);
    const { vy } = requireSaucer(await h.snapshot(), "weave-speed");
    const tick = run + step;
    if (tick > SETTLE_TICKS) read.push({ tick, vy });
    if (Math.abs(vy) > fastest) {
      fastest = Math.abs(vy);
      await captureStill(h, "weave");
    }
  }

  if (read.length === 0) {
    fail(
      "at least one reading of the weave past its first interval (specs/saucer.md)",
      "the watch was over before the first reroll was due",
    );
  }

  for (const { tick, vy } of read) {
    assertBetween(
      Math.abs(vy),
      SAUCER_WEAVE_SPEED - SPEED_TOLERANCE,
      SAUCER_WEAVE_SPEED + SPEED_TOLERANCE,
      `the magnitude of the vertical velocity the weave held at tick ${tick}, against SAUCER_WEAVE_SPEED (${SAUCER_WEAVE_SPEED}) within five percent (specs/saucer.md)`,
    );
  }
});
