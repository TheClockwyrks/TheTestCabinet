// instrumentation/set-next-chest-item — `setNextChestItem("brass")` on
// `playing` sets `nextChestItem` to `brass`, the snapshot reads it back, and
// the next chest, with nothing eligible to evolve, levels Brass.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes",
// `setNextChestItem(id)`): "when rule 2 of `specs/evolutions.md` decides that
// chest, the item rises by one level when it is held below its max level".
// specs/evolutions.md ("Opening a chest"), rule 2: "The result is `{ kind:
// "level", item, level }`, with `level` the level it became."
//
// THE POSE. An isolated night with Taper at level 3 and Brass at level 1, both
// below their max and nothing eligible to evolve, so either could be drawn and
// the pose is what decides; the chest is reached the real way through the
// harness's `openChest`. `TRIALS` (10) chests are opened under the same pose,
// so a build that ignored it and drew Brass by chance is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openChest,
  passiveSlot,
  type Harness,
} from "../harness";
import { poseChestNight } from "../evolutions/chest";

const TAPER_LEVEL = 3;
const BRASS_LEVEL = 1;
const TRIALS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("poses the item the next chest levels, and the chest levels it", async () => {
  poseChestNight(h);
  for (let trial = 1; trial <= TRIALS; trial += 1) {
    h.debug.setWeapon(0, "taper", TAPER_LEVEL);
    h.debug.setPassive(0, "brass", BRASS_LEVEL);
    h.debug.setNextChestItem("brass");
    assertEqual(
      h.snapshot().run.nextChestItem,
      "brass",
      `nextChestItem after the pose, trial ${trial}`,
    );

    const after = await openChest(h);
    if (trial === TRIALS) captureStill(h, "leveled");

    assertDeepEqual(
      after.run.chestResult,
      { kind: "level", item: "brass", level: BRASS_LEVEL + 1 },
      `the chest's result, trial ${trial}`,
    );
    assertEqual(
      after.run.passives[passiveSlot(after, "brass")]?.level,
      BRASS_LEVEL + 1,
      `Brass's level after the chest, trial ${trial}`,
    );
    if (after.screen === "chest") h.debug.setScreen("playing");
  }
});
