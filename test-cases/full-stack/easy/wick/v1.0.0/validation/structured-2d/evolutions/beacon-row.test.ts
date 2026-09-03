// evolutions/beacon-row — BEACON_STATS is in force.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/evolutions.md` ("Beacon"), `BEACON_STATS`: damage 20, cooldown
//     0.25, speed 500, radius 10, pierce 2, duration 2.0, amount 1.
//   - `specs/evolutions.md` ("Beacon"): "Beacon is Ember's bolt: a circle of
//     `radius` fired from the player's center at `speed` toward the nearest
//     enemy on the tick of firing, flying straight and removed after
//     `duration` seconds, with the row's `pierce`."
//   - `specs/evolutions.md` ("Passives still apply"): damage is "the fixed
//     damage times `damageMul`", every radius "the fixed length times
//     `areaMul`", amount "the fixed amount plus `amountBonus`", and "Speed,
//     pierce, duration ... are used as written". No passive is held, so every
//     multiplier is 1 and the bonus 0 (`specs/passives.md`).
//   - `specs/state.md` (`ProjectileState`) reports `vx`, `vy`, `radius`,
//     `damage`, `ttl` and `pierce`; the bolt's speed is the length of its
//     velocity, and its `ttl` on the firing tick is its `duration`, since
//     phase 6 of `specs/world.md` ("One tick") counts down only what "existed
//     before this tick".
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", so the slot reads 0.25 on the firing
//     tick.
//
// WHY THE WORLD IS POSED AS IT IS. Beacon "needs at least one enemy to fire",
// so an isolated run holds one moth 500 units out, far outside any overlap the
// bolt could make on the tick it is created — a bolt of radius 10 at the
// player's center and a moth of radius 10 overlap only inside 20 units
// (`specs/weapons.md`, Shapes and overlap) — so the firing tick creates the
// bolt and hits nothing, and the reading is the row rather than a hit. No
// passive is held, `weaponFire` is the one switch on, and the moth neither
// moves nor touches the lamplighter.
//
// THE TOLERANCE. `REAL_EPS` on each figure taken straight off the row, and
// `MOTION_EPS` on the speed, which is a stated speed times a unit vector and
// then a length; the count and the pierce are whole numbers read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BEACON_STATS, ENEMIES, MOTION_EPS, REAL_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { fireFromPosed } from "./evolved";

/** Where the one moth stands: 500 units out, clear of the bolt's first tick. */
const POST = { x: 300, y: 400 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates one bolt of radius 10, damage 20, pierce 2 and ttl 2.0 at speed 500, and sets the timer to 0.25", async () => {
  const reach = Math.hypot(POST.x, POST.y);
  if (!(reach > BEACON_STATS.radius + ENEMIES.moth.radius)) {
    throw new Error("the moth must stand clear of the bolt's launch point");
  }

  isolate(h);
  placeEnemyNear(h, "moth", POST.x, POST.y);
  const firing = await fireFromPosed(h, "beacon");
  captureStill(h, "row");

  assertEqual(
    firing.projectiles.length,
    BEACON_STATS.amount,
    "the bolts the firing tick created (specs/evolutions.md, Beacon)",
  );
  const bolt = firing.projectiles[0];
  assertNear(
    bolt.radius,
    BEACON_STATS.radius,
    REAL_EPS,
    `bolt ${bolt.id}'s radius (specs/evolutions.md, BEACON_STATS)`,
  );
  assertNear(
    bolt.damage,
    BEACON_STATS.damage,
    REAL_EPS,
    `bolt ${bolt.id}'s damage (specs/evolutions.md, BEACON_STATS)`,
  );
  assertNear(
    bolt.ttl,
    BEACON_STATS.duration,
    REAL_EPS,
    `bolt ${bolt.id}'s ttl on the firing tick (specs/evolutions.md, BEACON_STATS)`,
  );
  assertEqual(
    bolt.pierce,
    BEACON_STATS.pierce,
    `bolt ${bolt.id}'s pierce (specs/evolutions.md, BEACON_STATS)`,
  );
  assertNear(
    Math.hypot(bolt.vx, bolt.vy),
    BEACON_STATS.speed,
    MOTION_EPS,
    `bolt ${bolt.id}'s speed, the length of its velocity (specs/evolutions.md, BEACON_STATS)`,
  );
  assertNear(
    firing.after.run.weapons[firing.slot]?.cooldown ?? Number.NaN,
    BEACON_STATS.cooldown,
    REAL_EPS,
    "Beacon's timer after the firing (specs/weapons.md, Cooldown timers)",
  );
});
