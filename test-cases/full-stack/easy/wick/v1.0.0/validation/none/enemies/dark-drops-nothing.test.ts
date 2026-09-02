// Wick — enemies/dark-drops-nothing: the Dark's death leaves the field empty.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Drops"): "A death leaves
// its drop at the enemy's center on the tick it dies", and the `dark` row of
// that table reads "Nothing". Its roster row is "The Dark | `dark` | `dark` |
// 10000 | 170 | 50 | 40 | nothing | chase". `specs/world.md` ("Gems") gives the
// gem to a common alone — "Every common enemy drops one gem" — ("Pickups")
// gives the chest to "An elite", and ("The drop roll") settles the other two:
// "Elites and the Dark make no draw; an elite drops its chest, and the Dark
// drops nothing." So the tick the Dark dies on creates no gem and no pickup of
// any kind.
//
// THE POSE. An isolated night holding nothing but the lamplighter, one Dark at
// `(150, 0)` with its `hp` posed to `1`, and a level-1 Ember bolt on its
// center. Every faculty is held: `enemyMotion`, so it dies exactly where it was
// posed, and the rest so nothing else lands in the night. A bolt "hit[s] at the
// position it was created at" (`specs/world.md`, phase 6) and carries `10`
// damage (`specs/weapons.md`, row 1 of `EMBER_LEVELS` times a `damageMul` of
// `1`), so the one tick run takes the posed `1` below `0`. `150` is beyond the
// `48` pickup radius, so a drop that DID land would still be lying there to be
// counted rather than collected out of sight.
//
// TOLERANCE. None: the counts are exact, and the death itself is read as the
// Dark's absence from the tick's snapshot.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  newGems,
  newPickups,
  type Harness,
} from "../harness";
import { assertDead, killOne } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves no gem, no chest, no bread and no draft where the Dark died", async () => {
  const death = await killOne(h, "dark");
  await captureStill(h, "nothing");

  assertDead(death, "dark");
  assertEqual(
    newGems(death.before, death.after).length,
    0,
    "the gems the Dark's death dropped",
  );
  assertDeepEqual(
    newPickups(death.before, death.after).map((pickup) => pickup.kind),
    [],
    "the kinds of pickup the Dark's death dropped",
  );
});
