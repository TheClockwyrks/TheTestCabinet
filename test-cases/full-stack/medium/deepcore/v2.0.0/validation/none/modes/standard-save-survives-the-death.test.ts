// modes/standard-save-survives-the-death — a Standard save is not spent by being
// restored.
//
// specs/modes.md, Standard: "The save survives the death and can be restored
// again." So a second death falls back to the same save rather than to nothing: a
// build that deleted the slot on restoring, or on the death that used it, would
// leave the player with `PLAY AGAIN` the second time round.
//
// THE DRIVE IS TWO WHOLE CYCLES. Save, die, restore, die again, and read the Game
// Over screen still offering `CONTINUE FROM SAVE`. Each death is a hull standing
// at `0`, which specs/instrumentation.md says the game's own continuous check is
// what acts on, and each restore is the Game Over screen's first entry, which
// specs/ui.md fixes as `CONTINUE FROM SAVE` while a Standard save exists.
//
// ISOLATION. One Standard expedition on an empty mine with the slot cleared
// first, so the save that survives is the one this check banked, and the miner's
// body and drill gated throughout.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GAME_OVER_SAVE_ITEMS } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";
import {
  bankSave,
  driveDeath,
  menuLength,
  openAtCamp,
} from "../save/expedition";

/** The balance the save carries, so each restore is visibly the same save. */
const CREDITS = 2750;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("falls back to the same save a second time", async () => {
  await openAtCamp(h, { mode: "standard" });
  await h.debug.setCredits(CREDITS);
  await bankSave(h);

  const first = await driveDeath(h, "hull-destroyed");
  assertEqual(
    first.hasSave,
    true,
    "specs/modes.md: the first death leaves the save standing",
  );

  await h.debug.setMenuIndex(0);
  await h.tap(ACTION_KEY.activate);
  await h.advance(1);
  const restored = await h.snapshot();
  assertEqual(
    restored.screen,
    "in-mine",
    "specs/modes.md: CONTINUE FROM SAVE restores the expedition",
  );
  assertEqual(
    restored.credits,
    CREDITS,
    "specs/modes.md: the restored expedition is the saved one",
  );
  assertEqual(
    restored.hasSave,
    true,
    "specs/modes.md: restoring does not spend the save",
  );

  const second = await driveDeath(h, "hull-destroyed");
  const calls = await h.frameCalls();
  await captureStill(h, "again");
  assertEqual(
    second.hasSave,
    true,
    "specs/modes.md: the save survives the death that used it",
  );
  for (const item of GAME_OVER_SAVE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `specs/modes.md: the second Game Over screen still offers ${item}`,
    );
  }
  assertEqual(
    await menuLength(h),
    GAME_OVER_SAVE_ITEMS.length,
    "specs/ui.md: GAME_OVER_SAVE_ITEMS is the whole of the menu the second time too",
  );
});
