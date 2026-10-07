// Wick — weapons/death-on-tick: an enemy whose hp is at or below 0 dies on that
// tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Hits and death"): "On
// any tick an enemy's `hp` is at or below `0` after the hits the enemy dies on
// that tick: the kill count rises by one, the enemy drops what
// `specs/enemies.md` lists for it". `specs/world.md` (phase 6): "Then an enemy
// whose `hp` is at or below `0` dies: its drop and its bread or draft land at
// its center, at rest for this tick". `specs/enemies.md` gives a moth `5` hp
// and a `small` gem, and `specs/world.md` ("Gems"): "Every common enemy drops
// one gem of the tier ... at the enemy's position, on the tick it dies." A
// level-1 Ember bolt carries `10`, so one hit takes the moth below `0`.
//
// THE POSE. A moth at `(150, 0)` and a level-1 Ember bolt posed on its center
// with zero velocity, so the next tick's hit is the only thing that happens to
// it. Every faculty is held but `drops`, which is what the death leaves and so
// what this reads: `enemyMotion` is off so the moth dies exactly where it was
// posed, and the rest so nothing else lands in the night. The moth stands
// `150` from the lamplighter, beyond the `48` pickup radius, so its gem is not
// attracted on the tick it drops and lies where the moth died. The kill's
// bread and draft draws may leave a pickup beside the gem; the gem is read by
// tier among what the tick created.
//
// TOLERANCE. `POSITION_TOL` on the gem's position, which is a copy of the
// moth's posed center; none on the counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertUndefined } from "../assert";
import { ENEMIES, POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  newGems,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the moth stands: beyond the lamplighter's pickup radius. */
const MOTH = { x: 150, y: 0 };

/** Ticks recorded after the death, so the evidence shows the gem lying there. */
const AFTERMATH_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes a moth taken below 0, counts the kill, and drops its gem where it died", async () => {
  await isolate(h, { on: ["drops"] });
  const moth = await placeEnemy(h, "moth", MOTH.x, MOTH.y);
  await placeProjectile(h, "ember", MOTH.x, MOTH.y, 0, 0, 0);
  const before = await h.snapshot();

  const death = await captureReplay(h, "death", async () => {
    const tick = await h.step(1);
    await h.step(AFTERMATH_TICKS);
    return tick;
  });

  assertUndefined(enemyById(death, moth.id), "the moth in the tick's snapshot");
  assertEqual(death.run.kills, before.run.kills + 1, "kills after the tick");
  const gems = newGems(before, death).filter(
    (gem) => gem.tier === ENEMIES.moth.drop,
  );
  assertEqual(gems.length, 1, "small gems the tick dropped");
  assertNear(gems[0]!.x, MOTH.x, POSITION_TOL, "the gem's x");
  assertNear(gems[0]!.y, MOTH.y, POSITION_TOL, "the gem's y");
});
