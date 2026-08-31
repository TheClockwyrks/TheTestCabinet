// saucer/despawns-after-12s — a visit is finite, and it ends on its own clock.
//
// THE RULE. `specs/saucer.md`, Entry and travel: "A saucer leaves the field
// `SAUCER_LIFETIME` (`12` seconds) after it enters."
// `specs/instrumentation.md` gives a craft brought on by `addSaucer` "its own
// lifetime clock at zero", so a posed visit is timed from the pose.
//
// WHY BOTH SIDES ARE READ. The slot is asserted OCCUPIED half a second short of
// the figure and CLEAR half a second past it. Either half alone decides nothing: a
// build whose saucer never leaves passes "still up at 11.5 s", and a build that
// takes it off after a second passes "gone by 12.5 s". Together they place the
// departure inside a one-second window around `12`, which touches no other figure
// in the specification — not the `1.6` s fire interval, not the `1.0` s weave, and
// not the `25`-second floor on the gap that follows.
//
// THE MIND AND THE GUN ARE SHUT, AS THE ITEM STATES. Neither has anything to do
// with how long a visit lasts, and shutting them keeps the twelve seconds free of
// rounds and of steering decisions. The TRAVEL is left on, because a visit that
// is not flying is not the visit the rule is about: the craft crosses the field
// and wraps once over its lifetime, exactly as one does in play.
//
// `saucerSpawning` IS OFF, which `startPlaying` arranges, so the game's own
// arrival cannot put a second craft into the slot after the first leaves and turn
// a departure into an apparent survival.
//
// THE LANE IS CLEAR OF THE STAR. The crossing runs along `y = 100`, whose closest
// approach to the star's centre is `260` units — five times the `48` at which the
// craft's circle would touch the core — so a build that steers around the core has
// nothing to steer around and the visit ends for the one reason this point is
// about. Nothing on the field can end it either way: `specs/collision.md` gives
// the saucer no pair with the core, and `startPlaying` leaves no rock and no round.
//
// WHAT THIS DOES NOT DECIDE. What comes after the departure, which is
// `saucer/subsequent-gap`'s.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_LIFETIME } from "../../src/constants";
import { assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  poseSaucer,
  startPlaying,
  type Harness,
} from "../harness";
import { createMarchHarness, march, marchFrames } from "./visits";

/** Where the visit is posed. See the header for why this lane. */
const POSE_X = 200;
const LANE_Y = 100;

/**
 * The window the departure has to fall inside, in seconds of game time: half a
 * second either side of `SAUCER_LIFETIME` (`12`).
 */
const MARGIN = 0.5;
const UP_AT = SAUCER_LIFETIME - MARGIN;
const GONE_BY = SAUCER_LIFETIME + MARGIN;

let h: Harness;

beforeEach(async () => {
  h = await createMarchHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a saucer up at 11.5 s of its visit and has taken it off by 12.5 s", async () => {
  startPlaying(h);
  poseSaucer(h, POSE_X, LANE_Y);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);

  await march(h, marchFrames(UP_AT));
  const early = h.snapshot();

  await march(h, marchFrames(GONE_BY) - marchFrames(UP_AT));
  const late = h.snapshot();
  // The field the saucer left after its twelve seconds.
  captureStill(h, "departure");

  assertNotNull(
    early.saucer,
    `the saucer slot ${UP_AT} s into a visit, half a second short of ` +
      `SAUCER_LIFETIME (${SAUCER_LIFETIME} s) (specs/saucer.md)`,
  );
  assertNull(
    late.saucer,
    `the saucer slot ${GONE_BY} s into that visit, half a second past ` +
      `SAUCER_LIFETIME (${SAUCER_LIFETIME} s) — a saucer leaves the field ` +
      "after its lifetime (specs/saucer.md)",
  );
});
