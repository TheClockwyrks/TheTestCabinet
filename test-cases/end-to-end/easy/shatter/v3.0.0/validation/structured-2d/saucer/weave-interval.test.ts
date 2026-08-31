// saucer/weave-interval — the weave rerolls once a second, not on some other
// clock.
//
// THE RULE. `specs/saucer.md`, Entry and travel: the saucer sets its vertical
// velocity afresh "Every `SAUCER_WEAVE_INTERVAL` (`1.0` second), starting one full
// interval after it enters". `specs/instrumentation.md` has `addSaucer` bring a
// craft on with "its weave clock at `SAUCER_WEAVE_INTERVAL`", so the first reroll
// is due one whole interval after the pose and every one after it an interval
// later.
//
// WHAT IS READ. The game time of every tick on which the reported vertical
// velocity changed, over five intervals, and the gaps between them — the first
// measured from the pose, since that is where the specification starts the clock.
// Each gap is held to `1.0` s within twenty percent.
//
// TWENTY PERCENT IS `0.2` s, AND IT SEPARATES WHAT IT HAS TO. It is far wider than
// any reading error — a change is caught on the tick it happens, which is a
// hundred-and-twentieth of a second — and far narrower than the gap to any other
// figure a build might have rerolled on: half a second, two seconds, or the
// `1.6` s the gun fires on all fall outside it. It is the item's own allowance for
// a build whose interval accumulates a tick of drift per reroll.
//
// EVERY GAP IS ASSERTED, not their mean, so a build that rerolls on the right
// average with a wandering period fails on the reroll that wandered.
//
// THE WINDOW IS THE FIVE INTERVALS PLUS THE TOLERANCE. The fifth reroll is due at
// exactly `5.0` s, and the item allows it to land as late as `5.2` — so a window
// that stopped at `5.0` would report a build whose reroll fell a tick the far side
// of the boundary as having rerolled four times rather than as having rerolled
// slightly late, which is a verdict about the wrong thing. A build that never
// reaches five rerolls inside the window is still failed, on the count.
//
// TRAVEL AND THE GUN ARE SHUT, and the craft is held `492` units from the star, so
// what is read is the reroll clock alone: nothing moves, nothing fires, and
// nothing the craft decides over the five seconds can be the core avoidance that
// `specs/saucer.md` gives precedence over the weave.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_WEAVE_INTERVAL } from "../../src/constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the craft is held. See `weaves-vertically` for why here. */
const POSE_X = 200;
const POSE_Y = 140;

/** How many intervals the rerolls are watched over. */
const INTERVALS = 5;

/** The frame the still is kept from: the second reroll. */
const FILMED_REROLL = 2;

/** The twenty percent of SAUCER_WEAVE_INTERVAL the item allows each gap. */
const TOLERANCE = 0.2 * SAUCER_WEAVE_INTERVAL;

/**
 * How much game time the rerolls are watched over, in seconds.
 *
 * The five intervals plus the tolerance the last of them is allowed, so a reroll
 * that lands inside its allowance is counted rather than missed. See the header.
 */
const WINDOW = INTERVALS * SAUCER_WEAVE_INTERVAL + TOLERANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts one second of game time between the pose and each reroll of the vertical velocity", async () => {
  startPlaying(h);
  poseSaucer(h, POSE_X, POSE_Y);
  h.debug.setSaucerTravel(false);
  h.debug.setSaucerGun(false);

  let vy = requireSaucer(h.snapshot(), "the saucer posed for the weave").vy;
  const rerolls: number[] = [];

  for (let tick = 1; tick <= ticksFor(WINDOW); tick += 1) {
    await h.advance(1);
    const next = requireSaucer(
      h.snapshot(),
      `the saucer at tick ${tick} of the weave`,
    ).vy;
    if (next === vy) continue;
    vy = next;
    rerolls.push(seconds(tick));
    // The saucer on the tick its weave rerolled.
    if (rerolls.length === FILMED_REROLL) captureStill(h, "weave");
  }

  assertGreaterThanOrEqual(
    rerolls.length,
    INTERVALS,
    `rerolls of the vertical velocity over ${WINDOW.toFixed(1)} s — one is due ` +
      `every SAUCER_WEAVE_INTERVAL (${SAUCER_WEAVE_INTERVAL} s) ` +
      "(specs/saucer.md)",
  );

  // The first gap is measured from the pose, which is where the weave clock
  // starts: `addSaucer` brings a craft on with a full interval on it.
  let previous = 0;
  for (const [index, at] of rerolls.slice(0, INTERVALS).entries()) {
    assertLessThanOrEqual(
      Math.abs(at - previous - SAUCER_WEAVE_INTERVAL),
      TOLERANCE,
      `how far gap ${index + 1} between rerolls (${previous.toFixed(3)} s to ` +
        `${at.toFixed(3)} s) missed SAUCER_WEAVE_INTERVAL ` +
        `(${SAUCER_WEAVE_INTERVAL} s) by (specs/saucer.md)`,
    );
    previous = at;
  }
});
