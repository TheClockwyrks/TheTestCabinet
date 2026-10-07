// Wick — weapons/death-on-tick: an enemy whose hp a hit takes to 0 or below
// dies on that tick, counted and dropping its gem where it stood.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Hits and death"): "On any tick an enemy's `hp` is at
//     or below `0` after the hits the enemy dies on that tick: the kill count
//     rises by one, the enemy drops what `specs/enemies.md` lists for it".
//   - `specs/world.md` ("One tick"), phase 6: "Then an enemy whose `hp` is at
//     or below `0` dies: its drop and its bread or draft land at its center,
//     at rest for this tick".
//   - `specs/enemies.md` ("The roster", "Drops"): a moth has HP `5` and drops
//     a `small` gem; ("The life of an enemy"): "it is removed, the kill count
//     rises by one, its drop appears at its center".
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed Ember bolt
//     carries the level-1 damage `10` and "first hits ... on the next tick".
//   - `specs/world.md` ("Gems"): a gem "sits where it was dropped until it is
//     attracted", and attraction needs the gem within `pickupRadius` (`48`
//     with no Lure) of the lamplighter's center.
//
// WHAT IS READ. The snapshot after the one tick on which the bolt's 10 takes
// the moth's 5 to below 0: the moth is gone from `enemies`, `kills` rose by
// one, and a gem lies at the moth's posed center. All three are read from THAT
// tick's snapshot, so a build that removes the dead a tick late fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and one bolt on its center, 150
// units from the lamplighter, every switch off. The gem lands beyond the
// 48-unit pickup radius, so it is neither attracted nor collected and lies
// where the moth died for the reading. The death's bread and draft draws may
// add a pickup beside the gem; nothing here reads pickups.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the gem's position, which is the moth's
// posed center copied over. None on the count or the absence.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { EMBER_LEVELS, ENEMIES, FIGURE_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  enable,
  isolate,
  present,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** The enemy that dies: hp 5, below the bolt's 10. */
const TYPE = "moth";

/** Where the moth stands: along +x, beyond the pickup radius. */
const MOTH_DX = 150;

/** Ticks recorded after the death, so the evidence shows the gem lying still. */
const AFTERMATH_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes the moth, counts the kill, and drops its gem where it stood, on the tick of the hit", async () => {
  const posed = isolate(h);
  // The death's drop is part of the requirement this point decides.
  enable(h, "drops");
  assertGreaterThan(
    EMBER_LEVELS[0].damage,
    ENEMIES[TYPE].hp,
    "the bolt's damage against the moth's hp",
  );
  const moth = spawnEnemyNear(h, TYPE, MOTH_DX, 0);
  const placed = present(enemyById(h.snapshot(), moth), "the posed moth");
  spawnProjectileAt(h, "ember", placed.x, placed.y, 0, 0, 0);
  assertEqual(h.snapshot().run.gems.length, 0, "gems before the tick");

  const death = await captureReplay(h, "death", async () => {
    const after = await h.tick(1);
    await h.tick(AFTERMATH_TICKS);
    return after;
  });

  assertEqual(enemyById(death, moth), undefined, "the moth after the tick");
  assertEqual(death.run.kills, posed.run.kills + 1, "kills after the tick");
  const gem = present(death.run.gems[0], "the gem the moth dropped");
  assertWithin(gem.x, placed.x, FIGURE_TOLERANCE, "the gem's x");
  assertWithin(gem.y, placed.y, FIGURE_TOLERANCE, "the gem's y");
});
