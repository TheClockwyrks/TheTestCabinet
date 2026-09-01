// contact/end-shows-no-chest-overlay — an ending tick opens no chest overlay.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Fallen and dawn"): "A tick
// that ends the run opens no overlay: a chest it collected has its result
// applied and no overlay shown, with `chestResult` left set so the end screen's
// run reports it". Phase 12 of "One tick" orders it: "A tick that ends the run
// opens no overlay. Otherwise a tick that collected a chest opens the chest
// overlay". So a tick that collects a chest and leaves `hp` at 0 ends on
// `fallen`, with the chest gone from the field and its result recorded, rather
// than on `chest`.
//
// WHY BRASS 1 IS HELD. The chest is collected at phase 8 and the endings are
// checked at phase 11, so the result is applied BEFORE `hp` is judged. With
// nothing held, rule 3 of specs/evolutions.md ("Opening a chest") would heal
// `hp` by 30 and the run would not end at all. One passive below its max,
// Brass at level 1, makes rule 2 apply instead: "One held item below its max
// level ... is chosen uniformly at random ... and rises by `1`", and with one
// candidate the draw has one outcome, Brass 2. That result moves `hp` by
// nothing, so the `hp` posed to 0 is the `hp` the ending reads.
//
// THE DRIVE. An isolated night with every faculty held and nothing alive, Brass
// at level 1 held through `setPassive`, `hp` posed to -1 through `setHp`, and a
// chest posed at the lamplighter's center through `spawnPickup`, which is "the
// real collection path" (specs/instrumentation.md — `setScreen`). The health is
// posed below 0 rather than at it, so this point turns on the overlay rule
// alone: the boundary at exactly 0 is `contact/fallen-at-exactly-zero`'s. One
// tick is run.
//
// THE TOLERANCE. None: a screen name, the pickup list, and `chestResult` are
// exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  openChest,
  type Harness,
} from "../harness";

/** Brass at level 1: the one item below its max, so the chest levels it. */
const BRASS_LEVEL = 1;

/** The health posed: below 0, so the tick ends the run. */
const POSED_HP = -1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("collects the chest and ends fallen rather than opening the chest overlay", async () => {
  await isolate(h);
  await holdPassive(h, "brass", BRASS_LEVEL);
  await h.debug.setHp(POSED_HP);

  const after = await openChest(h);

  // The screen the ending tick left. Captured before the assertions, so a
  // failing build leaves the picture that shows why.
  await captureStill(h, "ended");

  assertEqual(
    (after.run.pickups ?? []).filter((pickup) => pickup.kind === "chest")
      .length,
    0,
    "chests left on the field after the ending tick collected one",
  );
  assertNotNull(
    after.run.chestResult,
    "chestResult after the ending tick collected a chest",
  );
  assertEqual(
    after.screen,
    "fallen",
    "the screen an ending tick that collected a chest leaves",
  );
});
