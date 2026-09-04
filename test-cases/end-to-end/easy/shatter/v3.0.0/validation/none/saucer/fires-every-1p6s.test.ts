// Shatter — saucer/fires-every-1p6s: the saucer's gun runs on its own clock.
//
// THE RULE. `specs/saucer.md`: "Every `SAUCER_FIRE_INTERVAL` (`1.6` seconds) on the
// field, the saucer fires ONE saucer bullet aimed at the ship's current position."
// So the reading is the gaps between consecutive shots, and how many rounds each of
// them put on the field.
//
// BETWEEN SHOTS, NOT FROM THE POSE. `specs/instrumentation.md` starts `addSaucer`'s
// fire clock at `SAUCER_FIRE_INTERVAL`, so a conformant build's first shot comes an
// interval after the pose — but whether a clock set to a full interval is due on
// the tick it reaches zero or on the one after is a tick-boundary question a build
// may answer either way, and the gaps BETWEEN shots are free of it. Five shots give
// four gaps, and every one of the four has to hold.
//
// AND EVERY FIRING PUTS EXACTLY ONE ROUND UP, which is the other half of the
// sentence: a build that fires a spread of three on the right cadence is not firing
// on the cadence the specification states. Both readings come off the same sweep,
// which samples every tick and calls a round new when the roster did not hold it
// the tick before.
//
// ITS MIND AND ITS TRAVEL ARE OFF, so the gun is read from a saucer standing still:
// nothing it decides moves it out of position and nothing it does changes the ship
// it is aiming at. The gun is the requirement and stays on. `startPlaying` has
// emptied the enemy-bullet roster, so every round the sweep sees is one this saucer
// fired.
//
// NO LEAD-IN IS SKIPPED. Every other check in this group that reads shots skips
// most of an interval to get to the next one cheaply; this one may not, because a
// build firing faster than the lead-in would have its extra rounds passed over and
// its cadence would read as correct.
//
// WHY TEN PERCENT. `0.16` seconds on a reading of `1.6`, and the item's own figure.
// The sweep samples every tick, a hundred and twentieth of a second, so it
// contributes half a percent of it. Every neighbouring figure fails: a build firing
// on the `1.0`-second weave interval is `37` percent under and one firing on the
// `1.4`-second bullet life is `12` percent under.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import { SAUCER_FIRE_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  poseSaucer,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { nextVolley } from "./cadence";

/** Where the saucer stands: quiet ground, far from the star. */
const STAND = { x: 320, y: 620 };

/** The five shots the item reads, which give the four gaps it asserts. */
const SHOTS = 5;

/** Ten percent of `SAUCER_FIRE_INTERVAL`: `0.16` seconds. See the header. */
const INTERVAL_TOLERANCE = SAUCER_FIRE_INTERVAL * 0.1;

/** How long the sweep waits for each shot before a silent gun is called on it. */
const SHOT_CEILING = ticksFor(4 * SAUCER_FIRE_INTERVAL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts one round up every SAUCER_FIRE_INTERVAL over five shots", async () => {
  await startPlaying(h);
  await poseSaucer(h, STAND.x, STAND.y, {
    vx: 0,
    vy: 0,
    mind: false,
    travel: false,
  });

  const gaps: number[] = [];
  let held: number[] = [];
  for (let shot = 0; shot < SHOTS; shot += 1) {
    const volley = await nextVolley(h, held, { maxTicks: SHOT_CEILING });
    held = volley.ids;
    if (shot > 0) gaps.push(secondsFor(volley.ticks));
    assertLength(
      volley.fired,
      1,
      `the rounds shot ${shot + 1} put on the field at once (specs/saucer.md)`,
    );
  }
  await captureStill(h, "cadence");

  for (const gap of gaps) {
    assertBetween(
      gap,
      SAUCER_FIRE_INTERVAL - INTERVAL_TOLERANCE,
      SAUCER_FIRE_INTERVAL + INTERVAL_TOLERANCE,
      "the seconds between two consecutive shots (specs/saucer.md)",
    );
  }
});
