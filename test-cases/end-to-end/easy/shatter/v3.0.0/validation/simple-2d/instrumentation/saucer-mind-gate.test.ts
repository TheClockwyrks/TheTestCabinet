// instrumentation/saucer-mind-gate — `setSaucerMind(false)` shuts the saucer's
// steering decisions, so its velocity is the one it was given; with its mind on,
// the weave reverses its vertical velocity.
//
// WHAT THE GATE COVERS, AND WHAT IT DOES NOT. `specs/instrumentation.md`: it
// "Gates the saucer's steering decisions alone: the vertical weave it rerolls every
// `SAUCER_WEAVE_INTERVAL` and the steering that keeps it clear of the star's core.
// Off, nothing it decides changes its velocity; it still travels and still fires."
// So the reading is the VELOCITY, and it is the only reading: a held course and a
// travelled one are the same fact here, and firing is another item's.
//
// THE SCENARIO IS A REAL CROSSING WITH THE GUN SHUT. Travel is left on, because a
// saucer whose course is being read should be flying one; the gun is shut, because
// a saucer that fired would be putting bullets on the field this item does not
// grade and whose flight the well would then be bending through the picture. The
// mind is the one faculty that differs between the two legs.
//
// THE ROW IS CHOSEN SO CORE AVOIDANCE NEVER ENGAGES. `specs/saucer.md` makes the
// steering that keeps the saucer clear of the core part of the same faculty as the
// weave, and gives that steering precedence over it — so a crossing lined up on the
// star would confound the two halves of one gate. The crossing here runs along
// `y = 160`, and the widest excursion the weave can reach over four intervals is
// 90 units, so the saucer's centre never comes within 110 units of the star: far
// outside the `CORE_R + SAUCER_R` (48) `specs/saucer.md` fixes, so nothing it
// decides here is an avoidance.
//
// THE READING IS THE WHOLE SWEEP, NOT ITS LAST TICK. `specs/saucer.md` reverses the
// vertical direction at EVERY reroll, so a saucer read only at the end of four
// intervals is read at one arbitrary phase of an oscillation. Both signs are
// therefore required to have been seen over the sweep, which is the honest reading
// of "reverses", and a build that steers once and then holds is caught by it.

import { afterEach, beforeEach, it } from "vitest";
import {
  SAUCER_SPEED,
  SAUCER_WEAVE_INTERVAL,
  SAUCER_WEAVE_SPEED,
} from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  startPlaying,
  theSaucer,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the saucer enters: the left of the field, 200 units above the star's row. */
const SAUCER_PLACE = { x: 80, y: 160 } as const;

/** How long each leg watches, in ticks: the four weave intervals the item names. */
const WEAVES = 4;
const SWEEP_FRAMES = ticksFor(WEAVES * SAUCER_WEAVE_INTERVAL);

/**
 * How far a velocity may drift from the one the saucer was given, in units per
 * second, on the leg where nothing may change it.
 *
 * Half a unit per second. `specs/saucer.md` says the well never pulls the saucer
 * and `specs/instrumentation.md` says nothing it decides changes its velocity with
 * the mind off, so the true figure is zero; the half unit is floating-point slack
 * and is 180 times smaller than the `SAUCER_WEAVE_SPEED` (90) a single reroll
 * would write.
 */
const HELD_TOLERANCE = 0.5;

/**
 * How large a vertical velocity counts as a weave, in units per second.
 *
 * Half of `SAUCER_WEAVE_SPEED`. A reroll sets the vertical velocity to exactly
 * `90`, so half of it is unambiguous in either direction while leaving a build
 * room to have measured the interval or the reversal slightly differently. What is
 * being decided is that the sign CHANGED, not what the magnitude was — the
 * magnitude is `saucer/weaves-at-90`'s.
 */
const WEAVE_FLOOR = SAUCER_WEAVE_SPEED / 2;

let h: Harness;

/** Every vertical velocity the saucer reported over the sweep, tick by tick. */
async function crossing(mind: boolean): Promise<number[]> {
  startPlaying(h);
  poseSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y);
  h.debug.setSaucerGun(false);
  h.debug.setSaucerMind(mind);

  const vertical: number[] = [];
  for (let tick = 0; tick < SWEEP_FRAMES; tick += 1) {
    await h.advance(1);
    vertical.push(theSaucer(h.snapshot(), "the crossing saucer").vy);
  }
  return vertical;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the course with the mind off, and reverses the weave with it on", async () => {
  // ---- The mind shut ------------------------------------------------------
  const held = await crossing(false);
  captureStill(h, "course");
  assertLessThanOrEqual(
    Math.max(...held.map(Math.abs)),
    HELD_TOLERANCE,
    "the largest vertical velocity a saucer with setSaucerMind(false) reported " +
      `over ${WEAVES} weave intervals: addSaucer brings one on with none`,
  );
  const saucer = theSaucer(
    h.snapshot(),
    "the saucer at the end of the crossing",
  );
  assertLessThanOrEqual(
    Math.abs(saucer.vx - SAUCER_SPEED),
    HELD_TOLERANCE,
    "the crossing speed a saucer with setSaucerMind(false) still carried, " +
      "against SAUCER_SPEED (specs/saucer.md)",
  );

  // ---- And the same crossing with its mind on -----------------------------
  const weaved = await crossing(true);
  assertGreaterThanOrEqual(
    Math.max(...weaved),
    WEAVE_FLOOR,
    `the largest downward vertical velocity over ${WEAVES} weave intervals ` +
      "with setSaucerMind(true) (specs/saucer.md: the weave reverses at every reroll)",
  );
  assertLessThanOrEqual(
    Math.min(...weaved),
    -WEAVE_FLOOR,
    `the largest upward vertical velocity over ${WEAVES} weave intervals ` +
      "with setSaucerMind(true) (specs/saucer.md: the weave reverses at every reroll)",
  );
});
