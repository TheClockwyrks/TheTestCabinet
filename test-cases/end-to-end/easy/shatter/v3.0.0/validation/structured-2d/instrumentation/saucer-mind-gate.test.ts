// instrumentation/saucer-mind-gate — with `setSaucerMind(false)` the saucer
// holds the course it was posed on; with its mind on, its vertical velocity
// reverses on the weave's own clock.
//
// THE RULE. `specs/instrumentation.md`, The saucer: "`setSaucerMind(enabled)`
// Gates the saucer's steering decisions alone: the vertical weave it rerolls
// every `SAUCER_WEAVE_INTERVAL` and the steering that keeps it clear of the
// star's core. Off, nothing it decides changes its velocity; it still travels
// and still fires." The weave itself is `specs/saucer.md`: "Every
// `SAUCER_WEAVE_INTERVAL` (`1.0` second), starting one full interval after it
// enters, it sets its vertical velocity to `SAUCER_WEAVE_SPEED` (`90`) directed
// opposite the vertical direction it is travelling in at that moment, so its
// vertical direction reverses at every reroll."
//
// THE SAUCER ARRIVES WITH NO VERTICAL COMPONENT, which is what makes the two
// legs read as different numbers. `addSaucer` brings it in "travelling right at
// `SAUCER_SPEED` with no vertical component ... its weave clock at
// `SAUCER_WEAVE_INTERVAL`", so with the mind off the reading stays `vy = 0`
// while a build whose weave ignores the gate reads `+90` or `-90`. The failure
// therefore names which model the build implemented rather than reporting a
// mismatch.
//
// THE SIGN IS READ AT THE SECOND AND THIRD REROLLS, never the first. The
// specification draws the direction of the FIRST reroll at random, and fixes
// only that the direction reverses at every reroll after it — so a check that
// asserted a direction on the first would be demanding one particular draw. Two
// consecutive rerolls have their relationship fixed whatever the draw was.
//
// GUN OFF, TRAVEL ON. The gun is gated because a firing saucer draws its aim
// error from the game's generator and puts rounds on a field this item is not
// about (`specs/saucer.md`); travel is left running because the weave belongs to
// a crossing, and holding the craft still would be reading the mind through the
// travel gate. The crossing is posed low and to the left — from `(60, 660)`,
// travelling right — so over the whole of the reading the saucer's centre stays
// more than `300` units from `(STAR_X, STAR_Y)`. `specs/saucer.md` has the mind
// steer only "where holding the weave's vertical velocity would carry the
// saucer's circle into the core", and one interval of the weave moves it `90`
// units, so no conformant build's avoidance can reach that far and confound the
// reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  SAUCER_SPEED,
  SAUCER_WEAVE_INTERVAL,
  SAUCER_WEAVE_SPEED,
} from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the crossing is posed: low and to the left, far from the star. */
const ENTRY = { x: 60, y: 660 };

/** How many weave intervals the held course is watched over. */
const HELD_INTERVALS = 4;

/**
 * When each of the two sign readings is taken, in weave intervals.
 *
 * Half an interval after a reroll, so the reading is of the velocity that reroll
 * set and never of the instant it is being replaced on.
 */
const FIRST_READING = 1.5;
const SECOND_READING = 2.5;

/**
 * The smallest vertical velocity that counts as a weave, in units per second.
 *
 * `specs/saucer.md` sets the weave to `SAUCER_WEAVE_SPEED` (`90`), so one unit
 * per second is roughly a hundredth of it: it rejects arithmetic noise and
 * nothing a build could mean.
 */
const WEAVING_FLOOR = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** A crossing posed with the gun held and the mind as the leg wants it. */
function poseCrossing(mind: boolean): void {
  startPlaying(h);
  poseSaucer(h, ENTRY.x, ENTRY.y);
  h.debug.setSaucerGun(false);
  h.debug.setSaucerMind(mind);
}

it("off, the saucer reports the same velocity four weave intervals on", async () => {
  poseCrossing(false);

  const posed = requireSaucer(h.snapshot(), "the posed saucer");
  assertEqual(posed.vx, SAUCER_SPEED, "it enters at cruise");
  assertEqual(posed.vy, 0, "it enters with no vertical component");

  await h.advance(ticksFor(HELD_INTERVALS * SAUCER_WEAVE_INTERVAL));

  // The saucer holding the course it was posed on.
  captureStill(h, "course");

  const held = requireSaucer(h.snapshot(), "the saucer with its mind off");
  assertEqual(
    held.vx,
    posed.vx,
    `with the mind off, ${HELD_INTERVALS} weave intervals change no vx`,
  );
  assertEqual(
    held.vy,
    posed.vy,
    `with the mind off, ${HELD_INTERVALS} weave intervals change no vy — a ` +
      `build whose weave ignores the gate reports +/-${SAUCER_WEAVE_SPEED}`,
  );
  assertEqual(held.mind, false, "the gate is still off");
});

it("on, the vertical velocity reverses from one weave reroll to the next", async () => {
  poseCrossing(true);

  await h.advance(ticksFor(FIRST_READING * SAUCER_WEAVE_INTERVAL));
  const first = requireSaucer(h.snapshot(), "after the first weave reroll").vy;
  assertGreaterThan(
    Math.abs(first),
    WEAVING_FLOOR,
    "with the mind on, the first reroll gives the saucer a vertical velocity",
  );

  await h.advance(
    ticksFor((SECOND_READING - FIRST_READING) * SAUCER_WEAVE_INTERVAL),
  );
  const second = requireSaucer(h.snapshot(), "after the second reroll").vy;
  assertGreaterThan(
    Math.abs(second),
    WEAVING_FLOOR,
    "the second reroll gives it a vertical velocity too",
  );

  assertEqual(
    Math.sign(second),
    -Math.sign(first),
    "each reroll sets the vertical velocity opposite the direction it was " +
      "travelling in, so the sign reverses from one reroll to the next " +
      "(specs/saucer.md)",
  );
});
