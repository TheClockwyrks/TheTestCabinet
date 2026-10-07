// Wick — sconce/decelerates: the sconce's velocity falls by SCONCE_DECEL a
// second along its launch direction, so after half a second of motion it
// carries half the speed it left with.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Sconce"): "Its velocity along `d` falls under a
//     constant acceleration of `−SCONCE_DECEL` (`600`) units per second
//     squared, integrated per tick as Projectiles and pierce states, position
//     first and then velocity, so after `n` moving ticks its velocity is
//     `(speed − SCONCE_DECEL × n × TICK_DT) × d`". The level-1 row has speed
//     `600`, so after 30 moving ticks the velocity is
//     `(600 − 600 × 30 / 60) × d`, which is `300 × d`, or `(180, 240)`.
//   - `specs/weapons.md` ("The nearest enemy"): a moth at `(300, 400)` from
//     the center gives `d` `(0.6, 0.8)`.
//   - `specs/world.md` ("One tick"), phase 6: "while `effectMotion` is on,
//     every remaining projectile moves ... and the sconces decelerate", and a
//     new projectile is "first moving on the next tick", so the 30 ticks run
//     after the firing tick are the sconce's first 30 moving ticks.
//   - `specs/instrumentation.md` (The driver switches): with `weaponFire` off
//     "every cooldown timer holds where it stands and nothing fires".
//
// WHAT IS READ. The sconce's velocity after 30 moving ticks, against `300 × d`
// component by component. A build that lets a sconce fly at a constant speed,
// decelerates at some other rate, or decelerates along a line other than its
// launch direction fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Sconce alone at level 1, whose
// row has amount `1`, so one sconce is watched. The firing tick runs with
// `weaponFire` on and `effectMotion` off, so the launch is read before any
// motion; then `weaponFire` goes off, so nothing fires again while the flight
// is watched, and `effectMotion` comes on, which is the faculty the
// deceleration runs under. `enemyMotion` stays off, so the moth holds `500`
// units out, beyond the `305` units this sconce reaches, and the flight hits
// nothing. A level-1 sconce lives `2.5` seconds, 150 ticks, so 30 ticks of
// flight end well before its `ttl` is due.
//
// TOLERANCE. `MOTION_TOLERANCE` on each velocity component, a figure the build
// reaches by adding the acceleration times `TICK_DT` thirty times over.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin, fail } from "../assert";
import { MOTION_TOLERANCE } from "../constants";
import {
  captureReplay,
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

/** The moving ticks watched: half a second, the level-1 sconce's half-life of speed. */
const FLIGHT_TICKS = 30;

/** The speed the level-1 row states a sconce leaves at: `600`. */
const SPEED = sconceRow(1).speed;

/** `(600 − 600 × 30 / 60) × d`, the velocity after the watched ticks. */
const EXPECTED = speedAfter(SPEED, FLIGHT_TICKS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the sconce at 300 × d after 30 moving ticks", async () => {
  const launch = await launchOne(h);
  beginFlight(h);

  const flight = await captureReplay(h, "slowing", () => h.trace(FLIGHT_TICKS));

  const slowed = projectileById(flight[FLIGHT_TICKS - 1], launch.sconce.id);
  if (slowed === undefined) {
    fail(`the sconce still in flight (tick ${FLIGHT_TICKS})`, "gone");
  }
  assertWithin(
    slowed.vx,
    EXPECTED * AIM.x,
    MOTION_TOLERANCE,
    `vx after ${FLIGHT_TICKS} moving ticks`,
  );
  assertWithin(
    slowed.vy,
    EXPECTED * AIM.y,
    MOTION_TOLERANCE,
    `vy after ${FLIGHT_TICKS} moving ticks`,
  );
});
