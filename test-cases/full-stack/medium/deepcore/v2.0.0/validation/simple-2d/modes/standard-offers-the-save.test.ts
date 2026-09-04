// modes/standard-offers-the-save — a Standard death with a save banked offers to
// continue.
//
// specs/modes.md, Standard: "With a save present, the Game Over screen offers
// `CONTINUE FROM SAVE` and `MENU`", and specs/ui.md names that pair
// `GAME_OVER_SAVE_ITEMS`. So the screen a Standard death reaches with a save in
// the slot carries exactly those two entries, and not the `PLAY AGAIN` a run with
// nothing to fall back on gets.
//
// TWO READINGS OF THE MENU, ANSWERING DIFFERENT HALVES. Its LENGTH is read by
// stepping the highlight down until it wraps, which specs/controls.md fixes as
// what `down` does on a menu screen. Its COPY is read off the frame the build
// drew, by substring, because a selection marker beside an entry is the build's
// own presentation.
//
// ISOLATION. One Standard expedition on an empty mine with the slot cleared
// first, so the save the screen offers is the one this check banked. The death is
// a hull standing at `0`, which specs/instrumentation.md says is not itself a
// death: the game's own continuous check is what ends the expedition. The miner's
// body and drill are gated, since neither is what the Game Over screen is about.

import { afterEach, beforeEach, it } from "vitest";
import { GAME_OVER_ITEMS, GAME_OVER_SAVE_ITEMS } from "../../src/constants";
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

it("offers CONTINUE FROM SAVE and MENU after a Standard death", async () => {
  await openAtCamp(h, { mode: "standard" });
  bankSave(h);

  const over = await driveDeath(h, "hull-destroyed");
  assertEqual(
    over.mode,
    "standard",
    "the expedition that died was played in Standard",
  );
  assertEqual(
    over.hasSave,
    true,
    "specs/modes.md: a Standard death leaves the save in the slot",
  );

  const calls = await h.frameCalls();
  captureStill(h, "offer");
  for (const item of GAME_OVER_SAVE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `specs/modes.md: the Standard Game Over screen offers ${item}`,
    );
  }
  assertEqual(
    drewText(calls, GAME_OVER_ITEMS[0]),
    false,
    "specs/modes.md: PLAY AGAIN is what a run with no save is offered instead",
  );
  assertEqual(
    await menuLength(h),
    GAME_OVER_SAVE_ITEMS.length,
    "specs/ui.md: GAME_OVER_SAVE_ITEMS is the whole of the menu",
  );
});
