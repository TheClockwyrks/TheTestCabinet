// enemies/crow-drops-medium-gem — a crow's death leaves one medium gem where
// it died.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Drops"): "A death
// leaves its drop at the enemy's center on the tick it dies", and its table
// gives a `common` "One gem of the tier in its row: `small`, `medium`, or
// `large`." The crow's row is `medium` ("Common enemies"). `specs/world.md`
// ("Gems") states it from the other side: "Every common enemy drops one gem of
// the tier `specs/enemies.md` lists for its type, at the enemy's position, on
// the tick it dies." So the tick the crow dies leaves the field holding
// exactly one gem, of tier `medium`, at the crow's own center; one more, one
// fewer, another tier, or another place all fail.
//
// WHY THE WORLD IS POSED AS IT IS. `enemies/drops` states the arrangement this
// check shares with the other drop checks: an isolated run holding one crow
// alone, its `hp` posed to the damage of a level-1 Oil Splash puddle laid at
// its own center, and the one tick on which that pulse lands and the death
// resolves. The field starts with no gem on it, so every gem read afterwards
// is one this death left, and the crow stands 200 units out, far outside the
// `48` a gem is attracted within and the `8` it is collected within
// (`specs/world.md`, Attraction and flight), so what it dropped is still lying
// where it fell.
//
// THE TOLERANCE. The count and the tier are compared exactly; the gem's
// distance from the center the crow died at is held to `REAL_EPS`, being a
// position copied from another.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, REAL_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  type Harness,
} from "../harness";
import { killWithPuddle } from "./drops";

const TYPE = "crow";

/** The tier `specs/enemies.md` lists in the crow's row. */
const TIER = ENEMIES[TYPE].gem;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves exactly one medium gem at the center a killed crow stood on", async () => {
  assertEqual(TIER, "medium", "the gem tier the crow's row gives");

  const death = await killWithPuddle(h, TYPE);
  captureStill(h, "drop");

  const { gems } = death.after.run;
  assertEqual(
    gems.length,
    1,
    "the gems on the field on the tick the crow died (specs/enemies.md, Drops)",
  );
  assertEqual(
    gems[0].tier,
    TIER,
    "the tier of the gem the crow dropped (specs/enemies.md, Drops)",
  );
  assertNear(
    distance(gems[0], death.at),
    0,
    REAL_EPS,
    "how far that gem lies from the center the crow died at (specs/enemies.md, Drops)",
  );
});
