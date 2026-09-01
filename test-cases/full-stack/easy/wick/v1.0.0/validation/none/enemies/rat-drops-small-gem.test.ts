// Wick — enemies/rat-drops-small-gem: a rat's death leaves a small gem.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Drops"): "A death
// leaves its drop at the enemy's center on the tick it dies", and a `common`
// leaves "One gem of the tier in its row: `small`, `medium`, or `large`". The
// rat's row is "Rat | `rat` | 15 | 120 | 8 | 12 | small | chase", so its tier
// is `small`. `specs/world.md` ("Gems") states the same drop from the other
// side: "Every common enemy drops one gem of the tier `specs/enemies.md` lists
// for its type, at the enemy's position, on the tick it dies", and
// `specs/weapons.md` ("Hits and death") fixes the tick: "On any tick an
// enemy's `hp` is at or below `0` after the hits the enemy dies on that tick".
//
// THE POSE. An isolated night holding nothing but the lamplighter, one rat at
// `(150, 0)` with its `hp` posed to `1`, and a level-1 Ember bolt on its
// center. Every faculty is held: `enemyMotion`, so it dies exactly where it
// was posed, and the rest so nothing else lands in the night. A bolt "hit[s]
// at the position it was created at" (`specs/world.md`, phase 6) and carries
// `10` damage (`specs/weapons.md`, row 1 of `EMBER_LEVELS` times a `damageMul`
// of `1`), so the one tick run takes the posed `1` below `0` and the death is
// the whole of what the tick does. `150` is beyond the `48` pickup radius, so
// the drop is neither attracted nor collected on the tick it lands.
//
// The kill also "draws for bread and for a draft, as that file states", so a
// pickup may land beside the gem; the point reads the gems the tick created
// and asks separately that no chest is among the pickups, which is what a
// `common` never drops.
//
// TOLERANCE. `POSITION_TOL` on the gem's position, a copy of the posed center;
// the count and the tier are exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkGemDrop } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves one small gem where the rat died", async () => {
  await checkGemDrop(h, "rat", "small");
});
