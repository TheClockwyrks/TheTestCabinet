// Wick — enemies/rat-drops-small-gem: a rat killed by a weapon leaves
// exactly one gem of tier `small` where it died.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The roster"): Rat's row lists gem `small`, and
//     its rank is `common`.
//   - `specs/enemies.md` ("Drops"): "A death leaves its drop at the enemy's
//     center on the tick it dies", and a `common` leaves "One gem of the tier
//     in its row: `small`, `medium`, or `large`".
//   - `specs/world.md` ("Gems"): "Every common enemy drops one gem of the tier
//     `specs/enemies.md` lists for its type, at the enemy's position, on the
//     tick it dies".
//
// WHAT IS READ. The one tick the bolt kills the rat on: `gems` holds
// exactly one gem, its tier is `small`, and it lies at the center the rat
// stood on. The death's bread and draft draws (specs/world.md, "The drop roll")
// may leave a pickup beside the gem, which is another point's business and
// nothing this one reads.
//
// HOW THE NIGHT IS POSED, AND THE TOLERANCE. `enemies/kill`: one rat 150
// units along +x with its hp posed to 1, one Ember bolt on its center, every
// switch off, and the field read on the tick it died. The gem's position is
// compared against the posed center within `FIGURE_TOLERANCE`; the count and
// the tier are compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, present, type Harness } from "../harness";
import { assertDroppedAt, killByBolt } from "./kill";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves one small gem where the rat died", async () => {
  const { after, at } = await killByBolt(h, "rat", "drop");

  assertEqual(after.run.gems.length, 1, "the gems the rat's death left");
  const gem = present(after.run.gems[0], "the gem the rat dropped");
  assertEqual(gem.tier, "small", "the tier of the rat's gem");
  assertDroppedAt(gem, at, "the rat's gem");
});
