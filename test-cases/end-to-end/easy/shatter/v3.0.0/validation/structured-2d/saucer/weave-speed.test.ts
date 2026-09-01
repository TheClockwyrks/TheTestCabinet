// saucer/weave-speed — every vertical velocity the weave takes IS
// SAUCER_WEAVE_SPEED, in both directions.
//
// THE RULE, AND IT IS AN EQUALITY. `specs/saucer.md`, Entry and travel: at each
// reroll the saucer "sets its vertical velocity to `SAUCER_WEAVE_SPEED` (`90`)
// directed opposite the vertical direction it is travelling in at that moment" —
// one speed, in one direction or the other — and nothing between two rerolls
// touches the vertical velocity again. So once the weave has run, the magnitude of
// the vertical velocity is `90` at every moment, and this point decides that
// figure in both directions.
//
// WHAT IS READ. Every reported vertical velocity across five weave intervals,
// sampled tick by tick, each held to `SAUCER_WEAVE_SPEED` within five percent.
// Every sample rather than the ones at a reroll, so a build that ramps its
// vertical velocity between rerolls — passing through the wrong figure on the way
// — is caught at the tick it was wrong on rather than at the tick the value
// happened to be read.
//
// A CEILING ALONE WOULD NOT DECIDE IT. A build weaving at five units per second is
// under a ceiling of `90` at every tick, changes sign at every reroll and rerolls
// on the stated interval, so it would pass this point, `saucer/weaves-vertically`
// and `saucer/weave-interval` alike — and the one figure the specification states
// about the weave would be decided by nothing.
//
// THE FIRST INTERVAL IS NOT READ, because the specification does not put the
// figure there: a saucer "enters with no vertical component" and rerolls "starting
// one full interval after it enters", so the vertical velocity is legitimately
// zero until the first reroll. Readings begin a few ticks after that interval has
// run, which leaves a build slack over exactly where in the tick it applies the
// reroll.
//
// FIVE PERCENT IS `4.5` UNITS PER SECOND either side of the figure, and it is a
// tolerance on the reading rather than room on the rule. A saucer is powered and
// the well never pulls it (`specs/gravity.md`), so a conformant build's weave sits
// at exactly `90`; the allowance covers a build that reaches the speed over a tick
// or two, and is an order of magnitude short of the next figure a build might have
// used (`SAUCER_SPEED` `140`).
//
// ONE REQUIREMENT ONLY. That the weave ever runs is `saucer/weaves-vertically`'s
// requirement and how often it rerolls is `saucer/weave-interval`'s; a build whose
// saucer never moves vertically fails there as well, which is what keeps one
// broken faculty costing the points it actually breaks.
//
// TRAVEL AND THE GUN ARE SHUT, and the craft is held `492` units from the star, so
// the vertical velocity read is the weave's and nothing else's — not the core
// avoidance `specs/saucer.md` gives precedence over it, which at that distance has
// nothing to answer.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_WEAVE_INTERVAL, SAUCER_WEAVE_SPEED } from "../../src/constants";
import { assertBetween, fail } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the craft is held. See `weaves-vertically` for why here. */
const POSE_X = 200;
const POSE_Y = 140;

/** How many intervals the weave is watched over. */
const INTERVALS = 5;

/** The band the item allows the reading: SAUCER_WEAVE_SPEED within five percent. */
const FLOOR = SAUCER_WEAVE_SPEED * 0.95;
const CEILING = SAUCER_WEAVE_SPEED * 1.05;

/**
 * The ticks that pass before a reading counts.
 *
 * One full weave interval, which the specification leaves the saucer with no
 * vertical component over, plus four ticks of slack for where in the tick a build
 * applies the reroll.
 */
const SETTLE_TICKS = ticksFor(SAUCER_WEAVE_INTERVAL) + 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds every vertical velocity the weave takes at SAUCER_WEAVE_SPEED", async () => {
  startPlaying(h);
  poseSaucer(h, POSE_X, POSE_Y);
  h.debug.setSaucerTravel(false);
  h.debug.setSaucerGun(false);

  let fastest = Math.abs(
    requireSaucer(h.snapshot(), "the saucer posed for the weave").vy,
  );
  const read: { tick: number; vy: number }[] = [];

  for (
    let tick = 1;
    tick <= ticksFor(INTERVALS * SAUCER_WEAVE_INTERVAL);
    tick += 1
  ) {
    await h.advance(1);
    const vy = requireSaucer(
      h.snapshot(),
      `the saucer at tick ${tick} of the weave`,
    ).vy;
    if (tick > SETTLE_TICKS) read.push({ tick, vy });
    if (Math.abs(vy) <= fastest) continue;
    fastest = Math.abs(vy);
    // The saucer at the fastest weave it drew, kept as the frame it drew it on.
    captureStill(h, "weave");
  }

  if (read.length === 0) {
    fail(
      "at least one reading of the weave past its first interval " +
        "(specs/saucer.md)",
      "the watch was over before the first reroll was due",
    );
  }

  for (const { tick, vy } of read) {
    assertBetween(
      Math.abs(vy),
      FLOOR,
      CEILING,
      "the magnitude of the vertical velocity the weave held at tick " +
        `${tick} of ${INTERVALS} x SAUCER_WEAVE_INTERVAL, against ` +
        `SAUCER_WEAVE_SPEED (${SAUCER_WEAVE_SPEED}) within five percent ` +
        "(specs/saucer.md)",
    );
  }
});
