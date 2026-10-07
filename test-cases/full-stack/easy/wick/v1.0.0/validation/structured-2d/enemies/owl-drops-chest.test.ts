// enemies/owl-drops-chest — an owl's death leaves one chest where it died,
// and no gem.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Drops"): "A death
// leaves its drop at the enemy's center on the tick it dies", and its table
// gives an `elite` "One chest." The owl is rank `elite` ("Elites and the
// Dark"), whose table names its drop as `chest` in the same row.
// `specs/world.md` ("Pickups") says where a chest comes from and where it
// lands: "`chest` | An elite, at its position, on the tick it dies." A gem is
// the common's drop alone, and the same file adds that "Elites and the Dark
// make no roll", so no bread and no draft either: what the tick leaves in
// `pickups` is one chest, and `gems` is untouched.
//
// WHY THE WORLD IS POSED AS IT IS. `enemies/drops` states the arrangement
// this check shares with the other drop checks: an isolated run holding one
// owl alone, its `hp` posed to the damage of a level-1 Oil Splash puddle
// laid at its own center, and the one tick on which that pulse lands and the
// death resolves. The field starts with no gem and no pickup on it, so
// everything read afterwards is what this death left. The owl stands 200
// units out, well outside the `PICKUP_ITEM_RADIUS + PLAYER_RADIUS` (`28`)
// a pickup is collected within (`specs/world.md`, Collection), so the chest
// is still lying where it fell rather than opened on the tick it landed.
//
// THE TOLERANCE. The two counts are compared exactly; the chest's distance
// from the center the owl died at is held to `REAL_EPS`, being a position
// copied from another.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  type Harness,
} from "../harness";
import { killWithPuddle } from "./drops";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves exactly one chest and no gem at the center a killed owl stood on", async () => {
  const death = await killWithPuddle(h, "owl");
  captureStill(h, "chest");

  const { gems, pickups } = death.after.run;
  assertEqual(
    pickups.length,
    1,
    "the pickups on the field on the tick the owl died (specs/enemies.md, Drops)",
  );
  assertEqual(
    pickups[0].kind,
    "chest",
    "the kind of the pickup the owl dropped (specs/enemies.md, Drops)",
  );
  assertNear(
    distance(pickups[0], death.at),
    0,
    REAL_EPS,
    "how far that chest lies from the center the owl died at (specs/world.md, Pickups)",
  );
  assertEqual(
    gems.length,
    0,
    "the gems on the field on the tick the owl died (specs/enemies.md, Drops)",
  );
});
