// Wick — sconce/integration-order: the first moving tick advances the sconce
// by the velocity it carried into the tick and only then slows that velocity.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Projectiles and pierce"): "On each tick it moves,
//     its position advances by its velocity times `TICK_DT`, and then its
//     velocity changes by its acceleration times `TICK_DT`".
//   - `specs/weapons.md` ("Sconce"): the deceleration is "integrated per tick
//     as Projectiles and pierce states, position first and then velocity, so
//     after `n` moving ticks its velocity is
//     `(speed − SCONCE_DECEL × n × TICK_DT) × d`". The level-1 row has speed
//     `600`, so the first moving tick advances the sconce by
//     `600 × TICK_DT`, which is `10` units along `d`, and leaves its velocity
//     at `(600 − 600 / 60) × d`, which is `590 × d`.
//   - `specs/weapons.md` ("The nearest enemy"): a moth at `(300, 400)` from
//     the center gives `d` `(0.6, 0.8)`, so the sconce sits at
//     `10 × (0.6, 0.8)` from its launch point, which is `(6, 8)`.
//   - `specs/world.md` ("One tick"), phase 6: a new projectile is "first
//     moving on the next tick", and the motion runs "while `effectMotion` is
//     on".
//
// WHAT IS READ. After exactly one moving tick: the sconce's center against
// the launch point plus `10 × d`, and its velocity against `590 × d`. A build
// that changes the velocity first advances by `590 × TICK_DT`, which is
// `9.8333` units, and lands `0.1667` units short, more than a hundred times
// the tolerance below; a build that never slows the velocity fails the second
// reading.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Sconce alone at level 1, whose
// row has amount `1`, so one sconce is watched. The firing tick runs with
// `effectMotion` off, so the launch point is the sconce's own posed center;
// then `weaponFire` goes off, so nothing fires again, and `effectMotion` comes
// on for exactly one tick, which is the whole span this reading needs.
// `enemyMotion` stays off, so the moth holds `500` units out and the one
// moving tick hits nothing.
//
// TOLERANCE. `MOTION_TOLERANCE` on each center component and each velocity
// component, figures a build reaches by one multiply and one add on stated
// figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin, fail } from "../assert";
import { MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  projectileById,
  type Harness,
} from "../harness";
import {
  AIM,
  beginFlight,
  launchOne,
  sconceRow,
  speedAfter,
} from "./boomerang";

/** The speed the level-1 row states a sconce leaves at: `600`. */
const SPEED = sconceRow(1).speed;

/** How far the first moving tick carries it: `600 × TICK_DT`, `10` units. */
const ADVANCE = SPEED * TICK_DT;

/** The speed it carries out of that tick: `600 − 600 / 60`, `590`. */
const SLOWED = speedAfter(SPEED, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("advances the sconce 10 units and leaves its velocity at 590 × d", async () => {
  const launch = await launchOne(h);
  beginFlight(h);

  const after = await h.tick(1);
  captureStill(h, "order");

  const moved = projectileById(after, launch.sconce.id);
  if (moved === undefined)
    fail("the sconce after its first moving tick", "gone");
  assertWithin(
    moved.x,
    launch.from.x + ADVANCE * AIM.x,
    MOTION_TOLERANCE,
    "x after the first moving tick",
  );
  assertWithin(
    moved.y,
    launch.from.y + ADVANCE * AIM.y,
    MOTION_TOLERANCE,
    "y after the first moving tick",
  );
  assertWithin(
    moved.vx,
    SLOWED * AIM.x,
    MOTION_TOLERANCE,
    "vx after the first moving tick",
  );
  assertWithin(
    moved.vy,
    SLOWED * AIM.y,
    MOTION_TOLERANCE,
    "vy after the first moving tick",
  );
});
