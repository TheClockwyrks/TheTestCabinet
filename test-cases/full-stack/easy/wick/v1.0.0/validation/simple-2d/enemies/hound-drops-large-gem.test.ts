// Wick — enemies/hound-drops-large-gem: a hound killed by a weapon leaves
// exactly one gem of tier `large` where it died.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The roster"): Hound's row lists gem `large`, and
//     its rank is `common`.
//   - `specs/enemies.md` ("Drops"): "A death leaves its drop at the enemy's
//     center on the tick it dies", and a `common` leaves "One gem of the tier
//     in its row: `small`, `medium`, or `large`".
//   - `specs/world.md` ("Gems"): "Every common enemy drops one gem of the tier
//     `specs/enemies.md` lists for its type, at the enemy's position, on the
//     tick it dies".
//
// WHAT IS READ. The one tick the bolt kills the hound on: `gems` holds
// exactly one gem, its tier is `large`, and it lies at the center the hound
// stood on. The death's bread and draft draws (specs/world.md, "The drop roll")
// may leave a pickup beside the gem, which is another point's business and
// nothing this one reads.
//
// HOW THE NIGHT IS POSED, AND THE TOLERANCE. `enemies/kill`: one hound 150
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

it("leaves one large gem where the hound died", async () => {
  const { after, at } = await killByBolt(h, "hound", "drop");

  assertEqual(after.run.gems.length, 1, "the gems the hound's death left");
  const gem = present(after.run.gems[0], "the gem the hound dropped");
  assertEqual(gem.tier, "large", "the tier of the hound's gem");
  assertDroppedAt(gem, at, "the hound's gem");
});
