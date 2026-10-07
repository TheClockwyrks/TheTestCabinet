// Wick — weapons/finite-pierce-hits-once: a projectile with finite pierce hits
// a given enemy at most once.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile with finite
//     pierce hits a given enemy at most once: its re-hit entry for that enemy
//     carries the projectile's remaining `ttl` at the hit, so the entry
//     outlives the projectile."
//   - `specs/state.md` (`EnemyHit.cooldown`): "A projectile with finite pierce
//     sets it to its own remaining `ttl`, so it hits each enemy at most once
//     in its life."
//   - `specs/weapons.md` ("Pin"): level-1 damage `6`, radius `6`, duration
//     `1.5`; `specs/enemies.md`: a hound has HP `120`, radius `18`.
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed pin with pierce
//     `3` first hits on the next tick and, with zero velocity and
//     `effectMotion` off, stays on the hound's center every tick after.
//
// WHAT IS READ. The hound's hp after the first tick, its 120 less the pin's 6,
// and after 60 ticks, the same. A pin that hits on every overlapping tick
// removes 6 sixty times; one that re-hits when its pierce allows removes it
// four times. Sixty ticks stay inside the pin's 90-tick life, so the pin is
// overlapping the hound on every tick read.
//
// WHY THE NIGHT IS POSED AS IT IS. One hound and one pin on its center, 150
// units from the lamplighter, every switch off. A hound outlasts sixty hits of
// 6, so a broken build is read by its hp rather than by a death.
//
// TOLERANCE. `FIGURE_TOLERANCE`: 120 − 6 is exact arithmetic on two stated
// figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE, PIN_LEVELS, ticksFor } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** The pierce the pin is posed with: room for three more hits, none allowed. */
const PIERCE = 3;

/** Where the scene stands: along +x, clear of the lamplighter. */
const DX = 150;

/** The span read, in ticks, inside the pin's 1.5-second life. */
const SPAN_TICKS = 60;

/** What the hound reads after exactly one hit. */
const EXPECTED_HP = ENEMIES.hound.hp - PIN_LEVELS[0].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("damages the hound once across 60 ticks of a pierce-3 pin on its center", async () => {
  assertLessThan(
    SPAN_TICKS,
    ticksFor(PIN_LEVELS[0].duration),
    "the span against the pin's life",
  );
  isolate(h);
  const hound = spawnEnemyNear(h, "hound", DX, 0);
  const placed = present(enemyById(h.snapshot(), hound), "the posed hound");
  spawnProjectileAt(h, "pin", placed.x, placed.y, 0, 0, PIERCE);

  const first = present(
    enemyById(await h.tick(1), hound),
    "the hound after the first tick",
  );
  assertWithin(
    first.hp,
    EXPECTED_HP,
    FIGURE_TOLERANCE,
    "the hound's hp after the first tick",
  );

  const after = await h.tick(SPAN_TICKS - 1);
  captureStill(h, "once");

  const later = present(
    enemyById(after, hound),
    `the hound after tick ${SPAN_TICKS}`,
  );
  assertWithin(
    later.hp,
    EXPECTED_HP,
    FIGURE_TOLERANCE,
    `the hound's hp after tick ${SPAN_TICKS}`,
  );
});
