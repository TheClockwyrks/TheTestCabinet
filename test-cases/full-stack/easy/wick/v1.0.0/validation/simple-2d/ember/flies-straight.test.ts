// Wick — ember/flies-straight: a bolt keeps its launch velocity tick over tick
// and advances along one line, whatever its target does afterward.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Ember"): a bolt "flies in a straight line", and
//     the level-1 row has speed `400`.
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile is a circle
//     that moves at a constant velocity from the tick after it is fired ... On
//     each tick it moves, its position advances by its velocity times
//     `TICK_DT`, and then its velocity changes by its acceleration times
//     `TICK_DT`". A bolt has no acceleration: `specs/state.md`
//     (`ProjectileState`, `ax`, `ay`): "Every projectile holds `0, 0` except a
//     Sconce", and the constant velocity above follows.
//   - `specs/world.md` ("One tick"), phase 6: "while `effectMotion` is on,
//     every remaining projectile moves ... a projectile's position advances
//     by its velocity times `TICK_DT`", and a new bolt is "first moving on the
//     next tick".
//   - `specs/weapons.md` ("Ember"): a bolt is aimed "on the tick of firing",
//     so where the moth goes after that tick changes nothing about the bolt.
//
// WHAT IS READ. The bolt over the 30 ticks after its firing tick, with the
// moth it was aimed at moved to the far side of the lamplighter the moment it
// was fired: on every tick its acceleration reads `(0, 0)`, its velocity reads
// the launch velocity, and its center reads the previous tick's center plus
// that velocity times `TICK_DT`. A bolt that homes, curves, slows, or stops
// fails on the tick it departs from the line.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Ember alone at level 1. The
// firing tick runs with `weaponFire` on and `effectMotion` off, so the bolt is
// read at its launch; then `weaponFire` goes off, so nothing fires again while
// the flight is watched, `effectMotion` comes on, which is the faculty this
// item is about, and the moth is posed 500 units behind the lamplighter, off
// the bolt's line, so the bolt hits nothing over the flight. `enemyMotion`
// stays off, so the moth holds where it was put. A level-1 bolt lives `2.0`
// seconds, 120 ticks, so 30 ticks of flight end well before its `ttl` is due.
//
// TOLERANCE. `MOTION_TOLERANCE` on each center component, a position
// integrated tick by tick; `FIGURE_TOLERANCE` on each velocity component, a
// stated figure carried unchanged; none on the acceleration, stated as `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin, fail } from "../assert";
import {
  FIGURE_TOLERANCE,
  MOTION_TOLERANCE,
  TICK_DT,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  disable,
  enable,
  projectileById,
  projectilesOf,
  type Harness,
} from "../harness";
import { armEmber, emberRow } from "./volley";

/** The moth the bolt is aimed at, 500 units out along `(0.6, 0.8)`. */
const MOTH = { x: 300, y: 400 };

/** Where the moth is put once the bolt is away: the opposite side, off the line. */
const MOTH_AFTER = { x: -300, y: -400 };

/** Ticks of flight watched: a quarter of the level-1 bolt's 120-tick life. */
const FLIGHT_TICKS = ticksFor(emberRow(1).duration) / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("advances the bolt by its launch velocity × TICK_DT on every tick, with acceleration (0, 0)", async () => {
  const volley = armEmber(h, 1, [MOTH]);
  const [moth] = volley.targets;

  const fired = await h.tick(1);
  const bolts = projectilesOf(fired, "ember");
  assertGreaterThan(bolts.length, 0, "Ember bolts after the firing tick");
  const launched = bolts[0];

  disable(h, "weaponFire");
  enable(h, "effectMotion");
  h.debug.setEnemyPosition(
    moth.id,
    volley.player.x + MOTH_AFTER.x,
    volley.player.y + MOTH_AFTER.y,
  );

  const flight = await captureReplay(h, "straight", () =>
    h.trace(FLIGHT_TICKS),
  );

  let previous = { x: launched.x, y: launched.y };
  flight.forEach((snapshot, index) => {
    const tick = index + 1;
    const bolt = projectileById(snapshot, launched.id);
    if (bolt === undefined) {
      fail(`the bolt still in flight (tick ${tick} of flight)`, "gone");
    }
    assertEqual(bolt.ax, 0, `tick ${tick} of flight: ax`);
    assertEqual(bolt.ay, 0, `tick ${tick} of flight: ay`);
    assertWithin(
      bolt.vx,
      launched.vx,
      FIGURE_TOLERANCE,
      `tick ${tick} of flight: vx`,
    );
    assertWithin(
      bolt.vy,
      launched.vy,
      FIGURE_TOLERANCE,
      `tick ${tick} of flight: vy`,
    );
    assertWithin(
      bolt.x,
      previous.x + launched.vx * TICK_DT,
      MOTION_TOLERANCE,
      `tick ${tick} of flight: x, from the tick before`,
    );
    assertWithin(
      bolt.y,
      previous.y + launched.vy * TICK_DT,
      MOTION_TOLERANCE,
      `tick ${tick} of flight: y, from the tick before`,
    );
    previous = { x: bolt.x, y: bolt.y };
  });
});
