// Wick — instrumentation/set-next-chest-item-discarded: a posed item that is
// at its max when the chest opens is discarded: the chest draws among the
// items below their max, and `nextChestItem` reads `null`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes"): "A value that is not valid at the moment its draw is made is
// discarded and the draw is made at random"; `setNextChestItem(id)`: "the
// item rises by one level when it is held below its max level, and otherwise
// the chest draws at random". specs/evolutions.md rule 2 draws "One held item
// below its max level".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with Taper at level 8
// beside no Wick, so it neither evolves nor is below its max, and Brass at
// level 1, the only item below its max; the posed item is Taper. The chest's
// draw has one candidate, so the discarded pose shows as Brass leveled.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  weaponIn,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards a posed item at its max and draws among the rest", async () => {
  await isolate(h);
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL, 0);
  await holdPassive(h, "brass", 1);
  await h.debug.setNextChestItem("taper");

  const opened = await openChest(h);
  await captureStill(h, "discarded");

  assertDeepEqual(
    opened.run.chestResult,
    { kind: "level", item: "brass", level: 2 },
    "the chest's result, drawn among the items below their max",
  );
  assertEqual(
    weaponIn(opened, "taper")?.level,
    MAX_WEAPON_LEVEL,
    "Taper's level, left at its max",
  );
  assertNull(opened.run.nextChestItem, "nextChestItem after the chest");
});
