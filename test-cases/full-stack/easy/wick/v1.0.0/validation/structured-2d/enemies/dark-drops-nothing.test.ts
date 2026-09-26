// enemies/dark-drops-nothing — the Dark's death leaves nothing behind.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Drops"): "A death
// leaves its drop at the enemy's center on the tick it dies", and its table
// gives `dark` the drop "Nothing." The roster names the same in the Dark's own
// row, whose Drops column reads `nothing` ("Elites and the Dark").
// `specs/world.md` ("The drop roll") closes the other two doors: "Elites and
// the Dark make no roll; an elite drops its chest, and the Dark drops
// nothing", so no bread and no draft either. The tick the Dark dies therefore
// leaves the field with no gem and no pickup at all, and the reading is those
// two counts at `0`.
//
// WHY THE WORLD IS POSED AS IT IS. `enemies/drops` states the arrangement this
// check shares with the other drop checks: an isolated run holding the Dark
// alone, its `hp` posed to the damage of a level-1 Oil Splash puddle laid at
// its own center, and the one tick on which that pulse lands and the death
// resolves. A puddle is the weapon rather than a Flare burst because
// `FLARE_IMMUNE` "holds `dark` alone", which is `dark-flare-immune`'s point;
// every other weapon "damages the Dark exactly as it damages any enemy"
// ("Elites and the Dark"). The field starts with no gem and no pickup on it,
// so anything read afterwards is something this death left, and a build that
// dropped a gem, a chest, bread, or a draft fails on the count that holds it.
//
// THE TOLERANCE. None: the two readings are counts, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { killWithPuddle } from "./drops";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves no gem and no pickup on the tick the Dark dies", async () => {
  const death = await killWithPuddle(h, "dark");
  captureStill(h, "nothing");

  const { gems, pickups } = death.after.run;
  assertEqual(
    gems.length,
    0,
    "the gems on the field on the tick the Dark died (specs/enemies.md, Drops)",
  );
  assertEqual(
    pickups.length,
    0,
    "the pickups on the field on the tick the Dark died (specs/enemies.md, Drops, and specs/world.md, The drop roll)",
  );
});
