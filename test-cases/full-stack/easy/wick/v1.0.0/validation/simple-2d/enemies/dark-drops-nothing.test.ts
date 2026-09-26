// Wick — enemies/dark-drops-nothing: the Dark killed by a weapon leaves the
// ground as it found it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Elites and the Dark"): the Dark's row is rank
//     `dark` and drops `nothing`.
//   - `specs/enemies.md` ("Drops"): a `dark` death leaves "Nothing".
//   - `specs/world.md` ("The drop roll"): "Elites and the Dark make no roll;
//     an elite drops its chest, and the Dark drops nothing", so neither bread
//     nor draft can appear either.
//
// WHAT IS READ. The one tick the bolt kills the Dark on: `gems` is empty and
// `pickups` is empty, so no gem, no chest, no bread, and no draft was left.
// Both lists are empty before the tick as well, so an empty reading after it is
// the death having left nothing rather than something having been collected.
//
// HOW THE NIGHT IS POSED, AND THE TOLERANCE. `enemies/kill`: the Dark 150 units
// along +x with its hp posed to 1, one Ember bolt on its center, every switch
// off, and the field read on the tick it died. The Dark takes the bolt's damage
// like any enemy, since `FLARE_IMMUNE` "holds `dark` alone" and names Flare
// alone (specs/enemies.md). Nothing here carries a tolerance: two counts, each
// decided exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { killByBolt } from "./kill";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves no gem and no pickup where the Dark died", async () => {
  const { after } = await killByBolt(h, "dark", "nothing");

  assertEqual(after.run.gems.length, 0, "the gems the Dark's death left");
  assertEqual(after.run.pickups.length, 0, "the pickups the Dark's death left");
});
