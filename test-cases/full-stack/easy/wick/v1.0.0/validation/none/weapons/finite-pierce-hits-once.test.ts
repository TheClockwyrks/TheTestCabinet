// Wick — weapons/finite-pierce-hits-once: a finite-pierce projectile hits a
// given enemy at most once.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Projectiles and
// pierce"): "A projectile with finite pierce hits a given enemy at most once:
// its re-hit entry for that enemy carries the projectile's remaining `ttl` at
// the hit, so the entry outlives the projectile." A pin's level-1 row carries
// damage `6` and duration `1.5`, so a pin posed with pierce `3` on a hound
// (`120` hp, `specs/enemies.md`) removes `6` on its first tick and nothing
// more over the `60` ticks that follow, inside its `90`-tick life.
//
// THE POSE. One hound and one pin posed on its center with zero velocity and
// pierce `3`, so the pin has pierce to spare and stays overlapping the hound
// on every tick — a build that re-hits per tick, or per the pin's re-hit
// interval as though it were a touching effect, takes more than `6`. Every
// faculty is held: `effectMotion` so the pin stays on the hound, `enemyMotion`
// so the hound stays under the pin, and the rest so nothing else lands.
//
// TOLERANCE. `FLOAT_TOL` on the hound's hp: `120 − 6` is exact, and a second
// hit is `6` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  mustProjectile,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the hound stands, clear of the lamplighter. */
const HOUND = { x: 200, y: 0 };

/** The pierce posed on the pin: enough for three more hits it must not spend here. */
const PIERCE = 3;

/** The span the pin is left on the hound. */
const TICKS = 60;

/** A pin's level-1 damage, `6`. */
const PIN_DAMAGE = weaponRow("pin", 1).damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("damages a hound once across 60 ticks under a pin with pierce to spare", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", HOUND.x, HOUND.y);
  const pin = await placeProjectile(h, "pin", HOUND.x, HOUND.y, 0, 0, PIERCE);

  const first = await h.step(1);
  assertNear(
    mustEnemy(first, hound.id).hp,
    ENEMIES.hound.hp - PIN_DAMAGE,
    FLOAT_TOL,
    "the hound's hp after the pin's first tick",
  );

  const later = await h.step(TICKS - 1);
  await captureStill(h, "once");
  assertEqual(
    mustProjectile(later, pin.id).pierce,
    PIERCE - 1,
    "the pin's pierce after the span",
  );
  assertNear(
    mustEnemy(later, hound.id).hp,
    ENEMIES.hound.hp - PIN_DAMAGE,
    FLOAT_TOL,
    `the hound's hp after ${TICKS} ticks under the pin`,
  );
});
