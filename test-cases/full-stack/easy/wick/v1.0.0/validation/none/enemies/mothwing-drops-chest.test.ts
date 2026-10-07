// Wick — enemies/mothwing-drops-chest: a mothwing's death leaves a chest.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Drops"): "A death
// leaves its drop at the enemy's center on the tick it dies", and an `elite`
// leaves "One chest". The Mothwing's row is "Mothwing | `mothwing` | `elite` |
// 600 | 90 | 20 | 28 | chest | chase", an `elite` whose Drops column reads
// `chest`. `specs/world.md` ("Pickups") states the same from the other side: a
// `chest` is dropped by "An elite, at its position, on the tick it dies". Only
// a common drops a gem there ("Every common enemy drops one gem"), and "Elites
// and the Dark make no roll" for bread or a draft ("The drop roll"), so the
// tick's whole yield is the one chest.
//
// THE POSE. An isolated night holding nothing but the lamplighter, one
// mothwing at `(150, 0)` with its `hp` posed to `1`, and a level-1 Ember bolt
// on its center. Every faculty is held: `enemyMotion`, so it dies exactly
// where it was posed, and the rest so nothing else lands in the night. A bolt
// "hit[s] at the position it was created at" (`specs/world.md`, phase 6) and
// carries `10` damage (`specs/weapons.md`, row 1 of `EMBER_LEVELS` times a
// `damageMul` of `1`), so the one tick run takes the posed `1` below `0` and
// the death is the whole of what the tick does. `150` is beyond the `48`
// pickup radius, so the drop is neither attracted nor collected on the tick it
// lands.
//
// TOLERANCE. `POSITION_TOL` on the chest's position, a copy of the posed
// center; the counts and the kind are exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkChestDrop } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves one chest and no gem where the mothwing died", async () => {
  await checkChestDrop(h, "mothwing");
});
