// Wick — instrumentation/set-next-chest-item: `setNextChestItem("brass")` on
// `playing` sets `nextChestItem` to `brass`, the snapshot reads it back, and
// the next chest, with nothing eligible to evolve, levels Brass.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextChestItem(id)`): "when rule 2 of `specs/evolutions.md`
// decides that chest, the item rises by one level when it is held below its
// max level". specs/evolutions.md ("Opening a chest"), rule 2: "The result is
// `{ kind: "level", item, level }`, with `level` the level it became."
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with Taper at level 3 and
// Brass at level 1, both below their max and nothing eligible to evolve, so
// either could be drawn and the pose is what decides; the chest is reached the
// real way through the harness's `openChest`. `TRIALS` (`10`) chests are
// opened under the same pose, so a build that ignored it and drew Brass by
// chance is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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
import { closeChest } from "../evolutions/stage";

const TAPER_LEVEL = 3;
const BRASS_LEVEL = 1;
const TRIALS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the item the next chest levels, and the chest levels it", async () => {
  await isolate(h);
  for (let trial = 1; trial <= TRIALS; trial += 1) {
    await holdWeapon(h, "taper", TAPER_LEVEL, 0);
    await holdPassive(h, "brass", BRASS_LEVEL, 0);
    await h.debug.setNextChestItem("brass");
    assertEqual(
      (await h.snapshot()).run.nextChestItem,
      "brass",
      `nextChestItem after the pose, trial ${trial}`,
    );

    const opened = await openChest(h);
    if (trial === TRIALS) await captureStill(h, "leveled");

    assertDeepEqual(
      opened.run.chestResult,
      { kind: "level", item: "brass", level: BRASS_LEVEL + 1 },
      `the chest's result, trial ${trial}`,
    );
    assertEqual(
      passiveIn(opened, "brass")?.level,
      BRASS_LEVEL + 1,
      `Brass's level after the chest, trial ${trial}`,
    );
    await closeChest(h, opened);
  }
});
