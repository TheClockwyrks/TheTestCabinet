// Wick — instrumentation/switch-drops: with `setDrops(false)` a moth killed by
// a bolt leaves nothing on the field, and with the switch back on the same kill
// leaves its gem where it died.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "`setDrops(on)` | `drops` | An enemy that dies leaves what
// `specs/world.md` gives it: a common's gem and the bread or draft its roll
// draws, and an elite's chest. | A death leaves nothing on the field and draws
// nothing from the generator. The enemy still dies, still counts as a kill, and
// still sounds." specs/world.md — "Gems": "While `drops` is on, every common
// enemy drops one gem of the tier `specs/enemies.md` lists for its type, at the
// enemy's position, on the tick it dies", and a moth's tier is that file's.
//
// WHY THE WORLD IS POSED AS IT IS. The kill is the real one: a moth at its own
// point and a level-1 Ember bolt posed on its center, so the tick's phase 6
// takes the moth below `0` and the death rule runs. Both kills happen
// `KILL_OFFSET` (`500`) units from the lamplighter, far outside `PICKUP_RADIUS`
// (`48`) and the pickup collection distance, so a gem the second kill leaves
// lies where it fell rather than flying off and being collected. Every other
// faculty is held, so nothing else could add or remove an entity.
//
// THE TOLERANCE. Counts and a position, all read exactly; the gem's center is
// the enemy's own, which specs/world.md states without a tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  newGems,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where each kill happens: far outside every collection distance. */
const KILL_OFFSET = 500;

/** The common each kill is: the lightest in specs/enemies.md, at 5 hp. */
const KILL_ENEMY = "moth";

/** A bolt that hits one enemy and stops. */
const NO_PIERCE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves nothing on a kill while off, and the gem once on", async () => {
  const opened = await isolate(h);
  assertEqual(opened.drops, false, "the drops switch an isolated night holds");

  await placeEnemy(h, KILL_ENEMY, KILL_OFFSET, 0);
  await placeProjectile(h, "ember", KILL_OFFSET, 0, 0, 0, NO_PIERCE);
  const held = await h.step(1);
  await captureStill(h, "held");
  assertEqual(held.run.kills, 1, "the kill the tick counted while off");
  assertLength(held.run.gems, 0, "the gems a kill left while off");
  assertLength(held.run.pickups, 0, "the pickups a kill left while off");

  await h.debug.setDrops(true);
  await placeEnemy(h, KILL_ENEMY, KILL_OFFSET, 0);
  await placeProjectile(h, "ember", KILL_OFFSET, 0, 0, 0, NO_PIERCE);
  const dropped = await h.step(1);
  await captureStill(h, "dropped");

  assertEqual(dropped.run.kills, 2, "the kills counted once the switch was on");
  const gems = newGems(held, dropped);
  assertLength(gems, 1, "the gems the kill left once the switch was on");
  assertEqual(gems[0]?.x, KILL_OFFSET, "the gem's x, the moth's own");
  assertEqual(gems[0]?.y, 0, "the gem's y, the moth's own");
});
