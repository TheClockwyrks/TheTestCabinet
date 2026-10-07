// Wick — instrumentation/set-next-chest-item-consumed: the next chest opened
// consumes a posed item whatever its result, so `nextChestItem` reads `null`
// after a chest that evolved.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextChestItem(id)`): "The next chest opened consumes it,
// whatever its result". specs/evolutions.md ("Opening a chest"), rule 1:
// Taper at `MAX_WEAPON_LEVEL` beside Wick evolves, so the chest never reaches
// rule 2 and the posed item is not applied.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with Taper at level 8 and
// Wick and Brass at level 1, the posed item Brass, so the chest evolves Taper
// and the pose has nothing to decide.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  passiveIn,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads null after a chest that evolved rather than leveled", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL, 0);
  await holdPassive(h, "wick", 1);
  await holdPassive(h, "brass", 1);
  await h.debug.setNextChestItem("brass");
  assertEqual(
    (await h.snapshot()).run.nextChestItem,
    "brass",
    "nextChestItem before the chest",
  );

  const opened = await openChest(h);
  await captureStill(h, "consumed");

  assertEqual(opened.run.chestResult?.kind, "evolve", "the chest's result");
  assertEqual(passiveIn(opened, "brass")?.level, 1, "Brass's level, unleveled");
  assertNull(opened.run.nextChestItem, "nextChestItem after the chest");
});
