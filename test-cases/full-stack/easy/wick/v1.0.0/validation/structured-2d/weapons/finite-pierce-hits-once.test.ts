// weapons/finite-pierce-hits-once — a finite-pierce projectile hits a given
// enemy at most once.
//
// THE SPEC LINE. `specs/weapons.md`, "Projectiles and pierce": "A projectile
// with finite pierce hits a given enemy at most once: its re-hit entry for
// that enemy carries the projectile's remaining `ttl` at the hit, so the entry
// outlives the projectile." So a pin standing on a hound for sixty ticks lands
// one hit, whatever pierce it has left.
//
// THE POSE. One hound at `(200, 0)`, `120` hp, and a pin posed at its center
// with zero velocity and pierce `3`: the pin's radius `6` and the hound's `18`
// overlap at distance `0`, the posed projectile "first hits ... on the next
// tick" (`specs/instrumentation.md`), and pierce `3` leaves the pin alive
// after that hit with `2` to spare, so nothing but the rule keeps it from
// hitting again. Sixty ticks is half the pin's `1.5` second `ttl` and twice
// the longest re-hit interval any weapon states (`0.5`), so a build that
// re-hit on any schedule would have landed a second hit. `effectMotion` is held
// so the pin stays on the hound, `enemyMotion` so the hound stays under it,
// `enemyContact` so no contact damage enters; nothing else runs.
//
// THE TOLERANCE. `REAL_EPS` on `120 − 6`, one subtraction; a second hit is
// six units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { PIN_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the hound stands and the pin is posed. */
const AT = { x: 200, y: 0 };

/** The pin's pierce: enough to survive its one hit with room to hit again. */
const PIERCE = 3;

/** Ticks the pin stands on the hound. */
const WATCH = 60;

/** Pin's level-1 damage, `6`, the damage a pin posed with Pin unheld carries. */
const DAMAGE = PIN_LEVELS[0].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands one hit on a hound a pierce-3 pin stands on for 60 ticks", async () => {
  isolate(h);
  const hound = placeEnemyNear(h, "hound", AT.x, AT.y);
  const before = enemyById(h.snapshot(), hound);
  if (before === undefined) throw new Error("the posed hound is missing");
  placeProjectile(h, "pin", before.x, before.y, 0, 0, PIERCE);

  const watched = await advanceTicks(h, WATCH);
  captureStill(h, "once");

  assertNear(
    enemyById(watched, hound)?.hp ?? NaN,
    before.hp - DAMAGE,
    REAL_EPS,
    `the hound's hp after ${WATCH} ticks under a finite-pierce pin, one hit of ${DAMAGE} from ${before.hp} (specs/weapons.md, Projectiles and pierce)`,
  );
});
