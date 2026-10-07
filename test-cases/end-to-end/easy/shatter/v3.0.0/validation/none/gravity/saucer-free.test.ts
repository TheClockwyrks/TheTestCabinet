// gravity/saucer-free — the well never pulls the saucer.
//
// `specs/gravity.md` names the saucer in its table of bodies as NOT pulled:
// "The ship and the saucer are powered craft with their own drive. The well never
// adds anything to their velocity, whatever their distance from the star, so each
// holds exactly the course it is steering." `specs/saucer.md` says it again from
// the saucer's side: "It is a powered craft. The well never pulls it." This item
// is the saucer half; `gravity/ship-free` is the ship half, so a build that
// exempted one craft and not the other fails exactly one of the two.
//
// THE READING IS THE VELOCITY, NOT THE PATH. `specs/gravity.md` states the rule
// as the well adding nothing to a powered craft's velocity, so that is what is
// read: both components of the saucer's velocity, two seconds on, against the
// ones it was posed with. A build that pulled it at all changes them.
//
// WHY THE SAUCER IS LEFT TRAVELLING. Its locomotion is not what is under test,
// but leaving it on is what makes the scenario the item's own — a craft CROSSING
// beside the well — and it sweeps the reading across a range of distances rather
// than one: posed 120 units above the star, it is 305 units out by the end, so
// the pull it is being tested against varies by a factor of six over the drive
// and no single distance can be special-cased through.
//
// WHY ITS OTHER TWO FACULTIES ARE OFF. The saucer decides things, and each
// decision is a way for the reading to move for a reason that is not the well.
// With its MIND on it rerolls a vertical weave every `SAUCER_WEAVE_INTERVAL`
// (1.0 second) — twice inside this drive — which would change `vy` by 90 with the
// well never touching it, and it steers around the core. With its GUN on it fires
// every `SAUCER_FIRE_INTERVAL` (1.6 seconds), putting a saucer bullet on the
// field, and a saucer bullet IS a pulled body: it would bend, and it would be
// bending in the still this item leaves behind. `specs/instrumentation.md` gates
// each faculty separately, so both are shut and the saucer's travel is all that
// remains.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { SAUCER_SPEED, STAR_X, STAR_Y } from "../constants";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import type { Vec } from "../geometry";

/** How far from the star the saucer is posed, as the review item states. */
const CROSSING_DISTANCE = 120;

/** Where that puts it: 120 units straight up the field from the star's centre. */
const ENTRY: Vec = { x: STAR_X, y: STAR_Y - CROSSING_DISTANCE };

/**
 * The velocity it crosses at, which is what `addSaucer` gives it.
 *
 * `specs/instrumentation.md` brings a saucer on "travelling right at
 * `SAUCER_SPEED` with no vertical component", so this is that pose read back
 * rather than a course of this check's own choosing.
 */
const CROSSING_VELOCITY: Vec = { x: SAUCER_SPEED, y: 0 };

/** The seconds of game time it crosses for, as the review item states. */
const HOLD_SECONDS = 2;

/**
 * How far either component of the velocity may have moved: half a unit per second.
 *
 * The specification's answer is that neither moves at all, so this is rounding
 * room. The nearest the saucer comes to the star over the drive is the 120 units
 * it starts at, where `specs/gravity.md` tabulates the pull at 312.5; a build
 * leaking one percent of it into the saucer changes a component by six over the
 * two seconds, which this catches twelve times over.
 */
const VELOCITY_TOLERANCE = 0.5;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves a saucer crossing beside the star on exactly the course it was given", async () => {
  await startPlaying(harness);
  await poseSaucer(harness, ENTRY.x, ENTRY.y, {
    vx: CROSSING_VELOCITY.x,
    vy: CROSSING_VELOCITY.y,
    mind: false,
    gun: false,
  });

  await harness.advance(ticksFor(HOLD_SECONDS));
  await captureStill(harness, "free");

  const saucer = requireSaucer(
    await harness.snapshot(),
    `a saucer crossing ${CROSSING_DISTANCE} from the star`,
  );
  assertLessThanOrEqual(
    Math.abs(saucer.vx - CROSSING_VELOCITY.x),
    VELOCITY_TOLERANCE,
    `units per second the saucer's vx moved over ${HOLD_SECONDS} seconds`,
  );
  assertLessThanOrEqual(
    Math.abs(saucer.vy - CROSSING_VELOCITY.y),
    VELOCITY_TOLERANCE,
    `units per second the saucer's vy moved over ${HOLD_SECONDS} seconds`,
  );
});
