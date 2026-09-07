// instrumentation/saucer-weave — `setSaucerWeave` decides which way the saucer's
// next reroll takes it from rest.
//
// THE RULE. `specs/instrumentation.md`: `setSaucerWeave(direction)` "sets the
// saucer's weave direction, `1` for down or `-1` for up: the direction its next
// reroll takes while it has no vertical velocity, as `specs/saucer.md` states."
// And `specs/saucer.md`: at a reroll a saucer "with no vertical velocity at that
// moment takes its weave direction instead", the vertical velocity being set to
// `SAUCER_WEAVE_SPEED` along it.
//
// THE SCENARIO IS `saucer/weaves-vertically`'S: a saucer standing still with its
// mind on, its travel and gun off, far from the star, so the only decision it
// makes is the weave. Both directions are posed, each on a fresh saucer at rest,
// and the vertical velocity is read just past the first reroll:
// `specs/saucer.md` times that "one full interval after it enters", and
// `addSaucer` brings a saucer on with its weave clock at `SAUCER_WEAVE_INTERVAL`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
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

/** The two directions posed: up first, which is not what `addSaucer` sets. */
const DIRECTIONS = [-1, 1] as const;

/** Just past the first reroll: one interval, and a few ticks over it. */
const PAST_REROLL = ticksFor(SAUCER_WEAVE_INTERVAL) + 3;

/** The decimal places the vertical velocity is read to: exactly. */
const READ_BACK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends the first reroll from rest the posed way", async () => {
  startPlaying(h);
  for (const [index, direction] of DIRECTIONS.entries()) {
    poseSaucer(h, STAND.x, STAND.y);
    h.debug.setSaucerVelocity(0, 0);
    h.debug.setSaucerTravel(false);
    h.debug.setSaucerGun(false);
    h.debug.setSaucerWeave(direction);
    assertEqual(
      requireSaucer(h.snapshot(), "the saucer posed").weave,
      direction,
      `setSaucerWeave(${direction}) read back (specs/instrumentation.md)`,
    );

    await h.advance(PAST_REROLL);
    if (index === 0) captureStill(h, "posed");
    assertCloseTo(
      requireSaucer(h.snapshot(), "the saucer past its first reroll").vy,
      direction * SAUCER_WEAVE_SPEED,
      READ_BACK_DIGITS,
      "the vertical velocity the first reroll set, with the weave posed " +
        `${direction > 0 ? "down" : "up"} (specs/saucer.md)`,
    );
  }
});
