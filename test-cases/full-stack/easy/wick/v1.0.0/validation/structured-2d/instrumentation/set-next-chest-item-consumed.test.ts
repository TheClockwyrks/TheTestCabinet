// Wick — instrumentation/set-next-chest-item-consumed: the next chest opened
// consumes a posed item whatever its result, so `nextChestItem` reads `null`
// after a chest that evolved.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes", `setNextChestItem(id)`): "The next chest opened consumes
// it, whatever its result". `specs/evolutions.md` ("Opening a chest"), rule
// 1: Taper at `MAX_WEAPON_LEVEL` beside Wick evolves, so the chest never
// reaches rule 2 and the posed item is not applied.
//
// THE POSE. An isolated night with Taper at level 8 and Wick and Brass at
// level 1, the posed item Brass, so the chest evolves Taper and the pose has
// nothing to decide.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  heldPassive,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads null after a chest that evolved rather than leveled", async () => {
  isolate(h);
  holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
  holdPassive(h, "wick", 1);
  holdPassive(h, "brass", 1);
  h.debug.setNextChestItem("brass");
  assertEqual(
    h.snapshot().run.nextChestItem,
    "brass",
    "nextChestItem before the chest",
  );

  const after = await openChest(h);
  captureStill(h, "consumed");

  assertEqual(after.run.chestResult?.kind, "evolve", "the chest's result");
  assertEqual(
    heldPassive(after, "brass")?.level,
    1,
    "Brass's level, unleveled",
  );
  assertNull(after.run.nextChestItem, "nextChestItem after the chest");
});
