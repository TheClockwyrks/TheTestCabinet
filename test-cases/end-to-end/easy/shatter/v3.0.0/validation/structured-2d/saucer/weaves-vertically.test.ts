// saucer/weaves-vertically — the saucer's vertical direction really does reverse,
// over and over.
//
// THE RULE. `specs/saucer.md`, Entry and travel: "Every `SAUCER_WEAVE_INTERVAL`
// (`1.0` second), starting one full interval after it enters, it sets its vertical
// velocity to `SAUCER_WEAVE_SPEED` (`90`) directed opposite the vertical direction
// it is travelling in at that moment, so its vertical direction reverses at every
// reroll."
//
// WHAT IS READ. The SIGN of the reported vertical velocity, sampled every tick
// across four weave intervals, and how many times it changed. Four intervals give
// a conformant build three reversals — the first reroll takes the craft off zero
// onto a drawn direction, and the three after it each reverse — so "at least twice"
// is met with a reversal to spare while a build that weaves once and holds, one
// that drifts vertically without ever reversing, and one that never weaves at all
// each fall short. A count of reversals rather than the velocity itself, because
// the speed of the weave and the interval between rerolls are the two points
// beside this one.
//
// TRAVEL IS SHUT, AND THAT IS THE ISOLATION. `setSaucerTravel(false)` holds the
// craft's centre where it stands, so what the weave DECIDES is read with no motion
// at all: the craft cannot drift toward the star, cannot reach a seam, and cannot
// leave the lane the scenario put it in over the four seconds. `setSaucerGun(false)`
// leaves the four seconds free of rounds. The mind — the faculty this point is
// about — is the one thing left running.
//
// THE CRAFT STANDS CLEAR OF THE STAR. `specs/saucer.md` gives keeping clear of the
// core precedence over the weave, so a craft posed near the star could legitimately
// hold one direction while it steered around. Posed at `(200, 140)` it is `492`
// units from the star's centre — ten times the `48` at which its circle would touch
// the core — so nothing it decides over these four seconds can be avoidance.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_WEAVE_INTERVAL } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the craft is held. See the header for why here. */
const POSE_X = 200;
const POSE_Y = 140;

/** How many weave intervals the sign is watched over. */
const INTERVALS = 4;

/**
 * The fewest reversals those four intervals must contain.
 *
 * Two. A conformant build reverses three times inside them — at the second, third
 * and fourth reroll, the first having taken the craft off zero — so two leaves a
 * reversal of margin for a build whose first reroll lands a tick either side of
 * the boundary, while still failing everything that does not reverse repeatedly.
 */
const MIN_REVERSALS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reverses the saucer's vertical direction at least twice over four weave intervals", async () => {
  startPlaying(h);
  poseSaucer(h, POSE_X, POSE_Y);
  h.debug.setSaucerTravel(false);
  h.debug.setSaucerGun(false);

  const reversals = await captureReplay(h, "weave", async () => {
    let sign = Math.sign(
      requireSaucer(h.snapshot(), "the saucer posed for the weave").vy,
    );
    let changes = 0;
    for (
      let tick = 0;
      tick < ticksFor(INTERVALS * SAUCER_WEAVE_INTERVAL);
      tick += 1
    ) {
      await h.advance(1);
      const next = Math.sign(
        requireSaucer(
          h.snapshot(),
          `the saucer at tick ${tick + 1} of the weave`,
        ).vy,
      );
      if (next !== 0 && sign !== 0 && next !== sign) changes += 1;
      if (next !== 0) sign = next;
    }
    return changes;
  });

  assertGreaterThanOrEqual(
    reversals,
    MIN_REVERSALS,
    `reversals of the saucer's vertical direction over ${INTERVALS} x ` +
      `SAUCER_WEAVE_INTERVAL (${INTERVALS * SAUCER_WEAVE_INTERVAL} s) with its ` +
      "travel held — the weave reverses its vertical direction at every reroll " +
      "(specs/saucer.md)",
  );
});
