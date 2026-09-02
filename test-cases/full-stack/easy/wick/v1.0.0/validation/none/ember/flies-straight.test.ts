// Wick — ember/flies-straight: a bolt keeps its velocity tick over tick and
// advances along its line, whatever its target does after the firing.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember"): "It flies in a
// straight line and is removed after `duration` seconds"; ("Projectiles and
// pierce"): "A projectile is a circle that moves at a constant velocity from
// the tick after it is fired ... On each tick it moves, its position advances
// by its velocity times `TICK_DT`, and then its velocity changes by its
// acceleration times `TICK_DT`". Sconce is the weapon that "falls under a
// constant acceleration" and Shard the one that bounces; a bolt is neither, so
// its velocity is the one the firing gave it on every tick, and under that
// integration a velocity that never changes is an acceleration of `(0, 0)`,
// which is what `specs/instrumentation.md` ("Snapshot shape") reports as a
// projectile's `ax`, `ay`. So on every tick after the firing the bolt's
// acceleration is `(0, 0)`, its velocity is the firing's, and its position is
// the previous tick's plus that velocity times `TICK_DT`.
//
// THE POSE. An isolated night, one moth at `(300, 400)`, and Ember fired at it
// at level 1 through the shared `fireWeapon` with `effectMotion` held, so the
// bolt's velocity is read exactly as the firing set it. Then the moth is moved
// to the far side of the lamplighter with `setEnemyPosition`, so a bolt that
// steered toward its target after the firing would turn away from its line,
// `effectMotion` is turned on, and thirty ticks are stepped one at a time. The
// bolt covers `200` units of its `2.0` seconds of flight, reaching neither its
// `ttl` nor the moth's new place, and `enemyMotion` stays held so the moth
// stands where it was moved to.
//
// TOLERANCE. `FLOAT_TOL` on the velocity and the acceleration each tick, which
// a build carries rather than computes; `POSITION_TOL` on each tick's step
// against the velocity times `TICK_DT`, an inexact product accumulated across
// thirty ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, POSITION_TOL, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  fireWeapon,
  isolate,
  mustProjectile,
  placeEnemy,
  type Harness,
} from "../harness";
import { EMBER, boltsOf } from "./stage";

/** The level whose row is fired: one bolt at `400` units per second. */
const LEVEL = 1;

/** The moth the bolt is fired at. */
const MOTH = { x: 300, y: 400 };

/** Where the moth is moved to once the bolt is away: the far side of the lamplighter. */
const MOTH_MOVED = { x: -300, y: 400 };

/** The ticks of flight read: half a second, well inside the `2.0` s duration. */
const FLIGHT_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps an Ember bolt's velocity and advances it by v × TICK_DT on every tick of its flight", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  const flight = await captureReplay(h, "straight", async () => {
    const firing = await fireWeapon(h, EMBER, LEVEL);
    const bolts = boltsOf(firing);
    assertEqual(
      bolts.length,
      1,
      "Ember bolts the firing tick created at level 1",
    );
    const bolt = bolts[0]!;

    await h.debug.setEnemyPosition(moth.id, MOTH_MOVED.x, MOTH_MOVED.y);
    await enable(h, "effectMotion");
    const ticks = await h.stepWatching(FLIGHT_TICKS);
    return { bolt, ticks };
  });

  const { bolt, ticks } = flight;
  assertEqual(ticks.length, FLIGHT_TICKS, "ticks of flight stepped");
  let previous = bolt;
  for (const [index, snapshot] of ticks.entries()) {
    const tick = index + 1;
    const now = mustProjectile(snapshot, bolt.id);
    assertNear(
      now.ax,
      0,
      FLOAT_TOL,
      `the bolt's acceleration on flight tick ${tick}, x`,
    );
    assertNear(
      now.ay,
      0,
      FLOAT_TOL,
      `the bolt's acceleration on flight tick ${tick}, y`,
    );
    assertNear(
      now.vx,
      bolt.vx,
      FLOAT_TOL,
      `the bolt's velocity on flight tick ${tick}, x`,
    );
    assertNear(
      now.vy,
      bolt.vy,
      FLOAT_TOL,
      `the bolt's velocity on flight tick ${tick}, y`,
    );
    assertNear(
      now.x - previous.x,
      bolt.vx * TICK_DT,
      POSITION_TOL,
      `the bolt's step on flight tick ${tick}, x`,
    );
    assertNear(
      now.y - previous.y,
      bolt.vy * TICK_DT,
      POSITION_TOL,
      `the bolt's step on flight tick ${tick}, y`,
    );
    previous = now;
  }
});
