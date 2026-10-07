// instrumentation/switch-drops — with `setDrops(false)`, a moth killed by a
// bolt leaves nothing on the field and makes no drop roll, so a posed
// `nextDrop` stands; with the switch back on the next kill leaves its gem and
// the posed drop beside it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches", `drops`: on, "An enemy that dies leaves what `specs/world.md`
// gives it: a common's gem and the bread or draft its roll drops, and an
// elite's chest"; off, "A death leaves nothing on the field and makes no drop
// roll, so a posed `nextDrop` stands. The enemy still dies, still counts as a
// kill, and still sounds." specs/world.md ("Gems"): "While `drops` is on, every
// common enemy drops one gem of the tier `specs/enemies.md` lists for its
// type". specs/instrumentation.md ("Drawn outcomes"), `setNextDrop`: "A death
// while `drops` is off ... leave[s] it standing."
//
// THE POSE. An isolated run, a moth 150 units along +x with its hp posed to 1
// and an Ember bolt on its center, which is past both collection distances so
// anything a death left would lie where it fell. One tick with the switch off:
// the moth is gone and the kill counted, the field is empty, and the posed
// drop stands. Then the same kill with the switch on, and the gem and the
// posed bread are there.
//
// THE TOLERANCE. None: counts, a kind, and a pose are exact figures.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNull,
  assertUndefined,
} from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** Where the moth stands: past `pickupRadius` and the collection distance. */
const KILL_DX = 150;

/** The hp posed, below the level-1 Ember bolt's damage. */
const POSED_HP = 1;

/** The drop posed before the held kill, which only the second kill may take. */
const POSED = "bread";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Arm one moth to die on the next tick; the id it took. */
function armKill(on: Harness, dx: number): number {
  const id = spawnEnemyNear(on, "moth", dx, 0);
  const { player } = on.snapshot().run;
  on.debug.setEnemyHp(id, POSED_HP);
  spawnProjectileAt(on, "ember", player.x + dx, player.y, 0, 0, 0);
  return id;
}

it("leaves nothing and no roll while off, and drops the gem when on", async () => {
  const posed = isolate(h);
  h.debug.setNextDrop(POSED);
  const first = armKill(h, KILL_DX);

  const held = await h.tick(1);
  captureStill(h, "held");

  assertUndefined(enemyById(held, first), "the moth after the killing tick");
  assertEqual(held.run.kills, posed.run.kills + 1, "the kill the tick counted");
  assertLength(held.run.gems, 0, "gems the death left with drops off");
  assertLength(held.run.pickups, 0, "pickups the death left with drops off");
  assertEqual(held.run.nextDrop, POSED, "the posed drop across a held death");

  enable(h, "drops");
  const second = armKill(h, KILL_DX * 2);
  const after = await h.tick(1);

  captureStill(h, "dropped");

  assertUndefined(enemyById(after, second), "the moth after the second tick");
  assertLength(after.run.gems, 1, "the gem the death left with drops on");
  assertLength(after.run.pickups, 1, "the pickup the death left with drops on");
  assertEqual(
    after.run.pickups[0]?.kind,
    POSED,
    "the posed drop, taken by the kill",
  );
  assertNull(after.run.nextDrop, "the pose once the kill consumed it");
});
