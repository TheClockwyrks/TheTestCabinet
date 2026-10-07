// gravity/ship-free — the well never touches the ship.
//
// THE RULE. `specs/gravity.md`, "Which bodies are pulled", gives the ship a flat
// `No`, and says why: "the ship and the saucer are powered craft with their own
// drive. The well never adds anything to their velocity, whatever their distance
// from the star, so each holds exactly the course it is steering."
// `specs/ship.md` states it a third time: "the star never pulls the ship, so it
// flies exactly where the player steers it."
//
// This is the other half of the case's signature, and it is the half a build gets
// wrong by writing one gravity pass over every body on the field. It is graded
// separately from `gravity/saucer-free` because a build can exempt one powered
// craft and forget the other.
//
// THE POSE, AND WHY IT IS AT REST. The ship, at rest, 120 units from the star, on
// a bearing of `245` degrees — off-axis, so a build whose exemption is written
// per-axis has nowhere to hide. At rest is the cleanest reading this requirement
// admits: `specs/ship.md` applies the ship's drag to its velocity every tick, and
// drag on a velocity of zero is zero, so a conformant build leaves the ship
// EXACTLY where it was put, with EXACTLY no velocity, and every unit read back is
// the well's.
//
// NO KEY IS HELD, so no thrust is applied and the facing never turns: the two
// things `specs/ship.md` lets change the ship's velocity are both absent, and the
// third — drag — cannot move a body at rest. `startPlaying` has already emptied
// the field and shut both world gates, so nothing arrives to touch it either.
//
// 120 UNITS IS WHERE THE WELL IS STRONGEST WITHOUT REACHING THE CORE. The law
// gives `312.5` units per second squared there, and `specs/collision.md` puts the
// ship in contact with the core at `CORE_R + SHIP_R` (`44`) — so the pose is well
// clear of the slide, which is `star-core/ship-slides-along-the-core`'s item and
// not this one, while sitting where a build that pulled the ship would show it
// hardest.
//
// TWO SECONDS, AND WHAT A PULLED SHIP DOES IN THEM. Integrating
// `specs/gravity.md`'s law with `specs/ship.md`'s drag from this pose, a ship the
// well pulled reaches the core in 0.63 seconds and spends the rest of the two
// grazing round it — 76 units of travel against a bound of one. A build that
// applies the pull for a SINGLE tick and then stops gains 2.60 units per second,
// five times the velocity bound. There is no way to be wrong here quietly.
//
// BOTH READINGS, because they catch different faults: the velocity catches a
// build that adds the well's acceleration to the ship, and the position catches a
// build that displaces the ship toward the star without going through its
// velocity at all.

import { afterEach, beforeEach, it } from "vitest";
import { MU, TICK_DT } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseShip,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { DEG, pullAt, speedOf } from "../geometry";
import { aroundTheStar } from "./well";

/** How far from the star the ship is posed, in units. */
const DISTANCE = 120;

/** The bearing it is posed on: off-axis, so no per-axis exemption reads right. */
const BEARING = 245 * DEG;

/** Where that puts it. */
const POSE = aroundTheStar(DISTANCE, BEARING);

/** The stretch of game time it is left alone for. */
const HOLD_TICKS = ticksFor(2);

/**
 * How fast the ship may be moving at the end, in units per second.
 *
 * A conformant build reads exactly zero: nothing in `specs/ship.md` adds to the
 * velocity of a ship with no key held, and its drag multiplies zero by a factor.
 * The bound is set against the smallest wrong reading instead — a build that lets
 * the well touch the ship for ONE tick gains `MU / 120^2 * TICK_DT` = 2.60 units
 * per second, five times this — so it is generous to floating point and closed to
 * every fault.
 */
const SPEED_TOLERANCE = 0.5;

/**
 * How far the ship's centre may have moved, in units.
 *
 * One unit, against the 76 a ship the well pulled covers from this pose before it
 * reaches the core, and against a conformant build's exact zero.
 */
const POSITION_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship at rest beside the star for two seconds", async () => {
  startPlaying(h);
  poseShip(h, { x: POSE.x, y: POSE.y, vx: 0, vy: 0 });

  await h.advance(HOLD_TICKS);

  // The ship holding its station beside the star.
  captureStill(h, "free");

  const ship = h.snapshot().ship;
  const pull = pullAt(POSE);

  assertLessThanOrEqual(
    speedOf(ship),
    SPEED_TOLERANCE,
    `the speed of an un-thrusting ship posed at rest ${DISTANCE} units from ` +
      `the star, two seconds on: the well never adds anything to a powered ` +
      `craft's velocity (specs/gravity.md, specs/ship.md), while the law at ` +
      `that distance would add ${(pull * TICK_DT).toFixed(3)} units per second ` +
      `every tick (MU ${MU} / ${DISTANCE}^2 = ${pull.toFixed(1)})`,
  );

  assertLessThanOrEqual(
    Math.hypot(ship.x - POSE.x, ship.y - POSE.y),
    POSITION_TOLERANCE,
    `how far the ship's centre moved from (${POSE.x.toFixed(2)}, ` +
      `${POSE.y.toFixed(2)}) over two seconds with no key held, in units: the ` +
      "well never pulls it and nothing else was acting on it " +
      "(specs/gravity.md, specs/ship.md)",
  );
});
