// contact/contact-hit — an overlapping enemy whose cooldown is due removes its
// damage from hp.
//
// THE SPEC LINE. `specs/world.md`, "Contact damage": "On every tick, for every
// live enemy, the enemy's circle overlaps the lamplighter's when the distance
// between their centers is less than the enemy's radius plus `PLAYER_RADIUS`.
// An overlapping enemy whose `contactCooldown` is due lands a hit: `hp` falls
// by `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`". A rat's damage is `8` and
// its radius `12` (`specs/enemies.md`, Common enemies), `PLAYER_RADIUS` is `12`
// and `armor` "is `0` with no Brass held", so the hit removes exactly `8`.
//
// WHY THE RAT STANDS 20 UNITS OFF. The overlap bound is `12 + 12 = 24`, and a
// center distance of `20` is inside it by four units, so a build whose overlap
// test is the specified one, and one off by a unit either way, both hit here;
// where the bound falls exactly is `contact-overlap-strict`'s point, not this
// one's.
//
// WHY THE FIRST TICK. "Every enemy carries its own contact cooldown,
// `contactCooldown`, a timer that is `0` when the enemy spawns", and a timer
// at `0` "stays due on every tick until it is set again" (Timers), so a rat
// posed through `spawnEnemy` hits on the very next tick and nothing has to be
// waited for. The world is otherwise empty: no weapon to kill the rat before
// contact, `enemyMotion` off so the rat stays where it was posed, and
// `enemyContact` the one switch turned on, because the hit is the behavior
// under test.
//
// THE TOLERANCE. `100 − 8` is a subtraction of two small integers, so the
// reading is held to `REAL_EPS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { BASE_MAX_HP, ENEMIES, PLAYER_RADIUS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The center distance the rat is posed at: inside `12 + 12` by four units. */
const OFFSET = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes a rat's 8 damage from hp on the tick it overlaps with its cooldown due", async () => {
  const rat = ENEMIES.rat;
  if (!(OFFSET < rat.radius + PLAYER_RADIUS)) {
    throw new Error("the posed offset must be inside the overlap bound");
  }

  const before = isolate(h);
  placeEnemyNear(h, "rat", OFFSET, 0);
  enable(h, "enemyContact");

  const after = await advanceTicks(h, 1);
  captureStill(h, "hit");

  assertNear(
    after.run.player.hp,
    before.run.player.hp - rat.damage,
    REAL_EPS,
    `hp after one contact hit of ${rat.damage} from ${BASE_MAX_HP} (specs/world.md, Contact damage)`,
  );
});
