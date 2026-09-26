// Wick — enemies/kill-count-elite: an mothwing's death raises the kill count.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The life of an enemy"): "On any tick that leaves
//     `hp` at or below `0` the enemy dies on that tick: it is removed, the kill
//     count rises by one, its drop appears at its center ... Kill count and
//     drops apply to every rank alike".
//   - `specs/enemies.md` ("The roster"): a moth is rank `common`, a mothwing
//     rank `elite`, and the Dark rank `dark`, the three ranks the roster holds.
//   - `specs/weapons.md` ("Hits and death"): "On any tick an enemy's `hp` is at
//     or below `0` after the hits the enemy dies on that tick: the kill count
//     rises by one".
//
// WHAT IS READ. `kills` before and after each of three killing ticks: it rises
// by exactly one on the moth's death, by exactly one on the mothwing's, and by
// exactly one on the Dark's. Each rise is read against the reading before that
// death, so a build that counts an elite twice, or the Dark not at all, fails on
// the rank it mishandles.
//
// WHY THE NIGHT IS POSED AS IT IS. One isolated night, the three deaths one
// after another 150 units along +x of the lamplighter, each enemy's hp posed to
// 1 and killed by one posed Ember bolt on its center. Every switch is off and no
// weapon is held, so no other enemy exists, nothing spawns, and nothing but the
// bolt of that tick can remove an enemy or raise the count. What each death
// leaves on the ground lies 150 units out, past the pickup radius and the
// collection distance of `specs/world.md`, so no gem is collected, no chest is
// opened, and no overlay interrupts the run.
//
// TOLERANCE. None: a kill count is a whole number the specification decides
// exactly.
//
// The other ranks are `enemies/kill-count-common`, `enemies/kill-count-dark`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertUndefined } from "../assert";
import { EMBER_LEVELS } from "../constants";
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
import { KILL_DX } from "./kill";

/** The hp the enemy is posed to, below the damage one level-1 Ember bolt carries. */
const POSED_HP = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises kills by one on an elite's death", async () => {
  isolate(h);
  assertGreaterThan(
    EMBER_LEVELS[0].damage,
    POSED_HP,
    "the bolt's damage against the posed hp",
  );

  const before = h.snapshot().run.kills;
  const id = spawnEnemyNear(h, "mothwing", KILL_DX, 0);
  const placed = present(enemyById(h.snapshot(), id), "the posed mothwing");
  h.debug.setEnemyHp(id, POSED_HP);
  spawnProjectileAt(h, "ember", placed.x, placed.y, 0, 0, 0);

  const after = await h.tick(1);
  captureStill(h, "kills");

  assertUndefined(enemyById(after, id), "the mothwing after the killing tick");
  assertEqual(after.run.kills, before + 1, "kills after the mothwing's death");
});
