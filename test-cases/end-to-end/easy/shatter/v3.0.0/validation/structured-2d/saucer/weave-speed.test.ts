// saucer/weave-speed — the weave never runs faster than SAUCER_WEAVE_SPEED.
//
// THE RULE. `specs/saucer.md`, Entry and travel: at each reroll the saucer "sets
// its vertical velocity to `SAUCER_WEAVE_SPEED` (`90`)" — one speed, in one
// direction or the other. So no vertical velocity the weave produces exceeds it,
// and that bound is what this point decides.
//
// WHAT IS READ. Every reported vertical velocity across five weave intervals,
// sampled tick by tick, and the largest magnitude among them, held to
// `SAUCER_WEAVE_SPEED` within five percent. Every sample rather than the ones at a
// reroll, so a build that ramps its vertical velocity between rerolls — reaching
// past `90` on the way — is caught at the tick it overshot rather than at the
// tick the value happened to be read.
//
// FIVE PERCENT IS `4.5` UNITS PER SECOND, and it is a tolerance on the reading
// rather than room on the figure. A saucer is powered and the well never pulls it
// (`specs/gravity.md`), so a conformant build's weave sits at exactly `90`; the
// allowance covers a build that reaches the speed over a tick or two, and is an
// order of magnitude short of the next figure a build might have used
// (`SAUCER_SPEED` `140`).
//
// THE BOUND ALONE. That the weave ever runs is `saucer/weaves-vertically`'s
// requirement and how often it rerolls is `saucer/weave-interval`'s; a build whose
// saucer never moves vertically fails there rather than here, which is what keeps
// one broken faculty costing one point.
//
// TRAVEL AND THE GUN ARE SHUT, and the craft is held `492` units from the star, so
// the vertical velocity read is the weave's and nothing else's — not the core
// avoidance `specs/saucer.md` gives precedence over it, which at that distance has
// nothing to answer.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_WEAVE_INTERVAL, SAUCER_WEAVE_SPEED } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
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

/** The five percent of SAUCER_WEAVE_SPEED the item allows the reading. */
const CEILING = SAUCER_WEAVE_SPEED * 1.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every vertical velocity the weave takes at or under SAUCER_WEAVE_SPEED", async () => {
  startPlaying(h);
  poseSaucer(h, POSE_X, POSE_Y);
  h.debug.setSaucerTravel(false);
  h.debug.setSaucerGun(false);

  let fastest = Math.abs(
    requireSaucer(h.snapshot(), "the saucer posed for the weave").vy,
  );
  let at = 0;

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
    if (Math.abs(vy) <= fastest) continue;
    fastest = Math.abs(vy);
    at = tick;
    // The saucer at the fastest weave it drew, kept as the frame it drew it on.
    captureStill(h, "weave");
  }

  assertLessThanOrEqual(
    fastest,
    CEILING,
    `the fastest vertical velocity the weave took over ${INTERVALS} x ` +
      `SAUCER_WEAVE_INTERVAL (${INTERVALS * SAUCER_WEAVE_INTERVAL} s), reached ` +
      `at tick ${at}, against SAUCER_WEAVE_SPEED (${SAUCER_WEAVE_SPEED}) plus ` +
      "five percent (specs/saucer.md)",
  );
});
