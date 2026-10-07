// Wick — enemies/spider-row: a spider carries its row of `ENEMIES`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("The roster"): "An enemy
// is a circle of `radius` units centered on its position `(x, y)` in world
// units, with `hp` health, a `speed` in units per second, and a contact
// `damage`", and its row is "Spider | `spider` | 40 | 80 | 12 | 14 | medium |
// chase". So four figures: `hp` and `maxHp` 40 at spawn, "It spawns at full
// health" ("The life of an enemy"); a step of 80 × `TICK_DT` units, "one
// tick's step is `speed * TICK_DT` units" ("Movement"); 12 health taken by a
// touch, `specs/world.md` ("Contact damage") "`hp` falls by
// `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`" with `armor` `0` and
// `BASE_MAX_HP` `100` to fall from; and a circle of radius 14, read through
// the same sentence's "the distance between their centers is less than the
// enemy's radius plus `PLAYER_RADIUS`", 14 + 12 = 26.
//
// The clock stands at `0`, where "`hpMul(time) = 1 + HP_SCALE_PER_MINUTE *
// floor(time / 60)`" ("Health scaling") is `1`, so the table `40` is the whole
// of `maxHp`.
//
// THE POSE. Three isolated nights, each holding nothing but the lamplighter
// and one spider, every faculty held but the one the reading is about. The
// first spawns it 300 along `+x`, reads `hp` and `maxHp` off the spawn, turns
// `enemyMotion` on and runs one tick, and measures how far its position
// travelled, which is what a chaser advances. The second and the third turn
// `enemyContact` on and stand it half a unit inside 26 and half a unit
// outside: an enemy "spawns ... with `age` `0`, `contactCooldown` `0`" and a
// timer at `0` "stays due on every tick" (`specs/world.md`), so the inside one
// hits on the first tick and the outside one never does. Recovery is
// `BASE_RECOVERY` (`0`) with no Tinder held, so a hit is the only thing that
// moves the lamplighter's health.
//
// TOLERANCE. `FLOAT_TOL` on the health figures, each a table figure or a
// difference of two; `POSITION_TOL` on the step, a speed times `TICK_DT`
// (`1/60`, inexact in binary). Half a unit either side of 26 is a quarter of
// the two units between the closest pair of radii the roster distinguishes,
// and the nearest wrong speed is 10 units per second away.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkEnemyRow } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns a spider at 40 health that steps 80 / 60 a tick, hits for 12, and reaches 26", async () => {
  await checkEnemyRow(h, "spider");
});
