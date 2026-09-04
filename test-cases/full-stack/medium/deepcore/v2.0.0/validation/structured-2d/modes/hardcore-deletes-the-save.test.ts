// modes/hardcore-deletes-the-save — a Hardcore death takes the save with it.
//
// specs/modes.md, Hardcore: "A death ends the expedition. The save is deleted, so
// a save banked at the pad does not survive the death", and the Game Over screen
// offers `PLAY AGAIN` and `MENU` rather than a restore. So `hasSave` reads false
// the moment the expedition ends, and the copy on the screen says so too.
//
// THE SAME DEATH, THE OTHER MODE. `modes/standard-offers-the-save` drives exactly
// this arrangement in Standard and reads the opposite answer, so the pair says
// the mode is what decided it rather than the death.
//
// ISOLATION. One Hardcore expedition on an empty mine with the slot cleared
// first, so the save that is deleted is the one this check banked. The death is a
// hull standing at `0`, which specs/instrumentation.md says the game's own
// continuous check acts on, and the miner's body and drill are gated.

import { afterEach, beforeEach, it } from "vitest";
import { GAME_OVER_ITEMS, GAME_OVER_SAVE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("deletes a banked save when the Hardcore expedition ends", async () => {
  await openAtCamp(h, { mode: "hardcore" });
  bankSave(h);

  const over = await driveDeath(h, "hull-destroyed");
  const calls = await h.frameCalls();
  captureStill(h, "gone");

  assertEqual(
    over.mode,
    "hardcore",
    "the expedition that died was played in Hardcore",
  );
  assertEqual(
    over.hasSave,
    false,
    "specs/modes.md: a Hardcore death deletes the save",
  );
  assertEqual(
    drewText(calls, GAME_OVER_SAVE_ITEMS[0]),
    false,
    "specs/modes.md: there is no save left to continue from",
  );
  for (const item of GAME_OVER_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `specs/modes.md: the Hardcore Game Over screen offers ${item}`,
    );
  }
  assertEqual(
    await menuLength(h),
    GAME_OVER_ITEMS.length,
    "specs/ui.md: GAME_OVER_ITEMS is the whole of the menu",
  );
});
