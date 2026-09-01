// Wick — instrumentation/remove-passive: with Bellows, Brass, and Lure held,
// `removePassive(1)` reads back `passives` as Bellows then Lure, `armor` 0
// from the next read.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The loadout"):
// "a removal moves the slots after it up by one"; `removePassive(slot)`:
// "Removes the passive in `slot`, a held slot." `armor` is
// "`BRASS_ARMOR_PER_LEVEL` (`1`) `×` the Brass level held", and "A passive not
// held counts as level `0`", so with Brass gone it reads 0.
//
// WHY THE WORLD IS POSED AS IT IS. Three passives with the middle one removed,
// so the slot after it must move up, and the removed one is Brass so its
// derived stat's return to base is readable in the same snapshot.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { armorOf } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes the gap a removal leaves, the derived stat following", async () => {
  await isolate(h);
  await h.debug.setPassive(0, "bellows", 1);
  await h.debug.setPassive(1, "brass", 1);
  await h.debug.setPassive(2, "lure", 1);
  assertEqual((await h.snapshot()).run.armor, armorOf({ brass: 1 }), "armor with Brass held");

  await h.debug.removePassive(1);
  const after = await h.snapshot();
  await captureStill(h, "closed");
  assertDeepEqual(
    after.run.passives,
    [
      { id: "bellows", level: 1 },
      { id: "lure", level: 1 },
    ],
    "the passives after removePassive(1)",
  );
  assertEqual(after.run.armor, armorOf({}), "armor with Brass removed");
});
