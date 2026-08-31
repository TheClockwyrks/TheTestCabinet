// gravity/saucer-free — the well never pulls the saucer.
//
// `specs/gravity.md` names the saucer in its table of bodies as NOT pulled: "The
// ship and the saucer are powered craft with their own drive. The well never adds
// anything to their velocity, whatever their distance from the star, so each
// holds exactly the course it is steering." `specs/saucer.md` says it again from
// the saucer's side. This item is the saucer half; `gravity/ship-free` is the
// ship half, so a build that exempted one craft and not the other fails exactly
// one of the two.
//
// THE READING IS THE VELOCITY, NOT THE PATH. `specs/gravity.md` states the rule
// as the well adding nothing to a powered craft's velocity, so that is what is
// read: both components, two seconds on, against the ones the pose gave it. A
// build that pulled it at all changes them, and reading the components rather
// than the speed catches a build whose pull happens to be square to the crossing.
//
// THE COURSE IT IS HELD TO IS THE ONE IT WAS SEEN ON. `specs/instrumentation.md`
// brings a saucer on "travelling right at `SAUCER_SPEED` with no vertical
// component", and that is the pose; but what this item requires is that the
// velocity does not CHANGE, so the two-seconds-on reading is compared against the
// velocity the snapshot reported the instant the saucer was posed, before any
// tick ran. A build whose `addSaucer` starts the saucer on the wrong course fails
// the instrumentation item that grades `addSaucer`, and is still measured here on
// the only thing this item is about — whether the well moved it.
//
// WHY THE SAUCER IS LEFT TRAVELLING. Its locomotion is not what is under test,
// but leaving it on is what makes the scenario the item's own — a craft CROSSING
// beside the well — and it sweeps the reading across a range of distances rather
// than one: posed 120 units above the star, it is 305 units out by the end, so
// the pull it is being held clear of varies by a factor of six over the drive and
// no single distance can be special-cased through.
//
// WHY ITS OTHER TWO FACULTIES ARE OFF. The saucer decides things, and each
// decision is a way for the reading to move for a reason that is not the well.
// With its MIND on it rerolls a vertical weave every `SAUCER_WEAVE_INTERVAL`
// (1.0 second) — twice inside this drive — which would change `vy` by
// `SAUCER_WEAVE_SPEED` (90) with the well never touching it, and it steers around
// the core. With its GUN on it fires every `SAUCER_FIRE_INTERVAL` (1.6 seconds),
// putting a saucer bullet on the field, and a saucer bullet IS a pulled body: it
// would bend, and it would be bending in the still this item leaves behind.
// `specs/instrumentation.md` gates each faculty separately, so both are shut and
// the saucer's travel is all that remains.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_LIFETIME, STAR_X, STAR_Y } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  startPlaying,
  theSaucer,
  ticksFor,
  type Harness,
} from "../harness";
import type { Point } from "./law";

/** How far from the star the saucer is posed, as the review item states. */
const CROSSING_DISTANCE = 120;

/** Where that puts it: 120 units straight up the field from the star's centre. */
const ENTRY: Point = { x: STAR_X, y: STAR_Y - CROSSING_DISTANCE };

/** The seconds of game time it crosses for, as the review item states. */
const HOLD_SECONDS = 2;

/**
 * How far either component of the velocity may have moved: half a unit per second.
 *
 * The specification's answer is that neither moves at all, so this is rounding
 * room. The nearest the saucer comes to the star over the drive is the 120 units
 * it starts at, where `specs/gravity.md` tabulates the pull at 312.5; a build
 * leaking one percent of that into the saucer changes a component by six over the
 * two seconds, which this catches twelve times over.
 */
const VELOCITY_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a saucer crossing beside the star on exactly the course it was given", async () => {
  startPlaying(h);
  const id = poseSaucer(h, ENTRY.x, ENTRY.y);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);

  // The course it set out on, read before a single tick has run.
  const posed = theSaucer(
    h.snapshot(),
    `the saucer ${id} on the field the instant it was posed`,
  );

  await h.advance(ticksFor(HOLD_SECONDS));
  captureStill(h, "free");

  const saucer = theSaucer(
    h.snapshot(),
    `the saucer ${id} still crossing beside the star after ${HOLD_SECONDS} ` +
      `seconds, well inside the ${SAUCER_LIFETIME}-second visit ` +
      `specs/saucer.md gives it`,
  );
  assertLessThanOrEqual(
    Math.abs(saucer.vx - posed.vx),
    VELOCITY_TOLERANCE,
    `units per second the saucer's vx moved from the ${posed.vx} it was ` +
      `posed on, over ${HOLD_SECONDS} seconds ` +
      `(specs/gravity.md: the well never pulls the saucer)`,
  );
  assertLessThanOrEqual(
    Math.abs(saucer.vy - posed.vy),
    VELOCITY_TOLERANCE,
    `units per second the saucer's vy moved from the ${posed.vy} it was ` +
      `posed on, over ${HOLD_SECONDS} seconds ` +
      `(specs/gravity.md: the well never pulls the saucer)`,
  );
});
