// contact/contact-hit — an overlapping enemy whose cooldown is due removes its
// damage from hp on the next tick.
//
// THE RULE, FROM THE SPEC. specs/world.md, Contact damage: "On every tick, for
// every live enemy, the enemy's circle overlaps the lamplighter's when the
// distance between their centers is less than the enemy's radius plus
// PLAYER_RADIUS. An overlapping enemy whose contactCooldown is due lands a hit:
// hp falls by max(MIN_DAMAGE_TAKEN, enemy damage − armor)". A rat's radius is
// 12 and its damage 8 (specs/enemies.md, The roster), PLAYER_RADIUS is 12, and
// "armor is 0 with no Brass held", so a rat 20 units from the lamplighter's
// center, inside the 24 the two radii sum to, removes exactly 8.
//
// WHY ONE TICK. A posed enemy "first hits ... on the next tick"
// (specs/instrumentation.md), its contactCooldown "is 0 when the enemy spawns"
// (specs/world.md), and "a timer at 0 stays due on every tick until it is set
// again" (specs/world.md, Timers), so the hit lands on the first tick run after
// the pose. The rat is posed 20 units along +x, 4 inside the boundary, so no
// rounding of the distance can carry it out of overlap.
//
// THE POSE. An isolated night: nothing else on the field, no weapon, and every
// switch off but enemyContact, which is the faculty this item is about. The rat
// holds its place with enemyMotion off, so what the tick can change about hp is
// the hit alone; recovery is 0 with no Tinder held, so hp before the tick is
// the fresh run's maxHp of 100 and after it 92.
//
// THE TOLERANCE is FIGURE_TOLERANCE: 100 − 8 is exact arithmetic on two stated
// figures, so 1e-9 is headroom for a build holding hp as a real number and
// nothing more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertWithin } from "../assert";
import {
  BASE_MAX_HP,
  ENEMIES,
  FIGURE_TOLERANCE,
  PLAYER_RADIUS,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy that hits: radius 12, damage 8. */
const TYPE = "rat";

/** Where the rat is posed: 20 units along +x, inside the 24 the radii sum to. */
const OFFSET = 20;

/** What the hit removes with no Brass held: the rat's damage, unreduced. */
const EXPECTED_HP = BASE_MAX_HP - ENEMIES[TYPE].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the rat's 8 damage from hp on the tick it overlaps with its cooldown due", async () => {
  const posed = isolate(h);
  assertEqual(posed.run.player.hp, BASE_MAX_HP, "hp of the fresh run");
  assertEqual(posed.run.armor, 0, "armor with no Brass held");
  enable(h, "enemyContact");
  spawnEnemyNear(h, TYPE, OFFSET, 0);
  // The pose stands inside the overlap the rule requires.
  assertLessThan(
    OFFSET,
    ENEMIES[TYPE].radius + PLAYER_RADIUS,
    "the posed distance against the radii's sum",
  );

  const after = await h.tick(1);
  captureStill(h, "hit");

  assertWithin(
    after.run.player.hp,
    EXPECTED_HP,
    FIGURE_TOLERANCE,
    "hp after the rat's hit",
  );
});
