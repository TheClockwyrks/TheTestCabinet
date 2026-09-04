// sconce/integration-order — a sconce advances by its velocity before its
// velocity changes.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Projectiles and
// pierce"): "On each tick it moves, its position advances by its velocity
// times `TICK_DT`, and then its velocity changes by its acceleration times
// `TICK_DT`", which "Sconce" restates as "integrated per tick ... position
// first and then velocity". So the first moving tick of a level-1 sconce, at
// `speed` 600 along `d`, advances it by `600 × TICK_DT` = 10 units along `d`
// and leaves its velocity at `(600 − 600 × TICK_DT) × d` = `590 × d`. A build
// that changed the velocity first advances only `590 × TICK_DT` = `9.833…`
// units on that tick, so the two orders are 1/6 of a unit apart on the very
// first tick and drift from there.
//
// WHY ONE TICK. The order is decided on the first moving tick; a longer span
// mixes it with the deceleration `decelerates` reads. `specs/instrumentation.md`
// makes a posed projectile "first move ... on the next tick, exactly as one a
// tick created", so that tick is the one run here.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one posed sconce
// and nothing else, with `effectMotion` on so "the sconces decelerate"
// (`specs/world.md`, phase 6) and every other switch off, so nothing hits it,
// nothing else fires, and no passive scales a figure. The sconce is posed at
// the lamplighter's center flying along `(0.6, 0.8)`, so both readings are
// offsets from a point the check named.
//
// THE TOLERANCE. `MOTION_EPS` on the position and the velocity, each one
// addition of a product of a table value and `TICK_DT`. The wrong order is
// `0.1666…` units away on the position, five orders of magnitude outside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertPointNear } from "../assert";
import { MOTION_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { LAUNCH_DIRECTION } from "./firing";
import {
  FIRST_STEP,
  placeSconce,
  poseFlight,
  speedAfter,
  traceSconce,
} from "./flight";

/** Where the sconce is posed, and what both readings are measured from. */
const START = { x: 0, y: 0 };

/** `START + 600 × TICK_DT × d`: the position after one tick, velocity first. */
const POSITION = {
  x: START.x + FIRST_STEP * LAUNCH_DIRECTION.x,
  y: START.y + FIRST_STEP * LAUNCH_DIRECTION.y,
};

/** `(600 − 600 × TICK_DT) × d` = `590 × d`: the velocity after that tick. */
const VELOCITY = {
  x: speedAfter(1) * LAUNCH_DIRECTION.x,
  y: speedAfter(1) * LAUNCH_DIRECTION.y,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the sconce 10 units and leaves its velocity at 590 × d on the first moving tick", async () => {
  poseFlight(h);
  const id = placeSconce(h, START.x, START.y, LAUNCH_DIRECTION);

  const [sconce] = await traceSconce(h, id, 1);
  captureStill(h, "order");

  assertPointNear(
    sconce,
    POSITION,
    MOTION_EPS,
    "the sconce's center after its first moving tick, against a step of its launch velocity (specs/weapons.md, Projectiles and pierce)",
  );
  assertPointNear(
    { x: sconce.vx, y: sconce.vy },
    VELOCITY,
    MOTION_EPS,
    "its velocity after that tick, against (speed − SCONCE_DECEL × TICK_DT) × d (specs/weapons.md, Sconce)",
  );
});
