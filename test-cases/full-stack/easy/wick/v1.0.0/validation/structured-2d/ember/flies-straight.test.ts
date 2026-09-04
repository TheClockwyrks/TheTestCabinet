// ember/flies-straight — the bolt flies in a straight line.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember"): the bolt
// "flies in a straight line", and ("Projectiles and pierce"): "A projectile
// is a circle that moves at a constant velocity from the tick after it is
// fired ... On each tick it moves, its position advances by its velocity
// times `TICK_DT`, and then its velocity changes by its acceleration times
// `TICK_DT`." `specs/state.md` (`ProjectileState`) fixes that acceleration:
// "Every projectile holds `0, 0` except a Sconce". So a bolt fired at
// `(240, 320)` keeps `(240, 320)` on every tick, reports `ax`, `ay` of `0`,
// and steps `(4, 5.333…)` a tick, which is `400 × TICK_DT` along its line.
//
// WHY THE MOTH IS MOVED AFTER THE FIRING. The aim is read "on the tick of
// firing" and nothing afterward turns the bolt, which is what "straight"
// means against a bolt that tracked its target. So once the bolt is away the
// moth is posed to a point behind the lamplighter, well off the bolt's line
// and outside its reach, and the bolt's flight must not change. The moth is
// left in the world rather than removed so the flight is read with a target
// present to be tracked.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run, one moth at the first
// post, Ember at level 1 armed, `weaponFire` on. After the firing tick
// `effectMotion` is turned on, because "while `effectMotion` is on, every
// remaining projectile moves" (`specs/world.md`, phase 6), and the flight is
// sampled a tick at a time for one second, 60 of the 120 ticks the bolt's
// `ttl` of 2 lasts. `enemyMotion` stays off so the moth's own step is not what
// moves it, and every other switch stays off.
//
// THE TOLERANCE. `REAL_EPS` on the velocity and the acceleration, which are
// held rather than computed, and `MOTION_EPS` on each tick's step, one
// product of a stated speed and `TICK_DT`, against a build whose bolt curves
// or slows by whole units over the second.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertPointNear } from "../assert";
import { MOTION_EPS, REAL_EPS, TICK_DT, TICK_HZ } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  projectileById,
  type Harness,
  type SnapshotProjectile,
} from "../harness";
import { fireEmber, TARGET_POSTS } from "./firing";

/** Level 1 of Ember: one bolt. */
const LEVEL = 1;

/** The moth the bolt is aimed at: `(300, 400)`. */
const POST = TARGET_POSTS[0];

/** Where the moth is posed once the bolt is away: behind the lamplighter, off the line. */
const MOVED_TO = { x: -400, y: -300 };

/** How long the flight is sampled: one second, 60 ticks of the bolt's 120. */
const FLIGHT_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the fired velocity and steps 400 × TICK_DT along it on every tick", async () => {
  const firing = await fireEmber(h, LEVEL, [POST]);
  assertEqual(firing.bolts.length, 1, "the bolts the firing tick created");
  const fired = firing.bolts[0];
  h.debug.setEnemyPosition(firing.targets[0], MOVED_TO.x, MOVED_TO.y);
  enable(h, "effectMotion");

  const trace = await captureReplay(h, "straight", async () => {
    const samples: SnapshotProjectile[] = [];
    for (let tick = 1; tick <= FLIGHT_TICKS; tick += 1) {
      const s = await advanceTicks(h, 1);
      const bolt = projectileById(s, fired.id);
      assertEqual(
        bolt !== undefined,
        true,
        `the bolt still in flight on tick ${tick} of the second`,
      );
      samples.push(bolt as SnapshotProjectile);
    }
    return samples;
  });

  let previous = fired;
  trace.forEach((bolt, i) => {
    const tick = i + 1;
    assertNear(
      bolt.vx,
      fired.vx,
      REAL_EPS,
      `vx on tick ${tick}, against the velocity it was fired with`,
    );
    assertNear(
      bolt.vy,
      fired.vy,
      REAL_EPS,
      `vy on tick ${tick}, against the velocity it was fired with`,
    );
    assertNear(bolt.ax, 0, REAL_EPS, `ax on tick ${tick}`);
    assertNear(bolt.ay, 0, REAL_EPS, `ay on tick ${tick}`);
    assertPointNear(
      bolt,
      {
        x: previous.x + fired.vx * TICK_DT,
        y: previous.y + fired.vy * TICK_DT,
      },
      MOTION_EPS,
      `the bolt's center on tick ${tick}, one step of velocity × TICK_DT on`,
    );
    previous = bolt;
  });
});
