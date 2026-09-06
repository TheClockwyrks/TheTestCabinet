// modes/standard-without-a-save — a Standard death with nothing banked offers a
// fresh expedition.
//
// specs/modes.md, Standard: "With no save present, the Game Over screen offers
// `PLAY AGAIN` and `MENU`", and specs/ui.md names that pair `GAME_OVER_ITEMS`. So
// the same mode shows a different menu depending on the slot, and a build that
// offered a restore with nothing to restore would strand the player on a dead
// entry.
//
// The mirror of `modes/standard-offers-the-save`, and read the same two ways: the
// menu's length by stepping the highlight until it wraps, its copy off the frame
// the build drew.
//
// ISOLATION. One Standard expedition on an empty mine with the slot cleared and
// never written to, the death driven as a hull standing at `0` so the game's own
// continuous check ends the expedition, and the miner's body and drill gated.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GAME_OVER_ITEMS, GAME_OVER_SAVE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { drewText } from "../case-harness/index";
import { driveDeath, menuLength, openAtCamp } from "../save/expedition";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("offers PLAY AGAIN and MENU after a Standard death with no save", async () => {
  await openAtCamp(h, { mode: "standard" });

  const over = await driveDeath(h, "hull-destroyed");
  assertEqual(
    over.mode,
    "standard",
    "the expedition that died was played in Standard",
  );
  assertEqual(over.hasSave, false, "the slot was cleared and never written to");

  const calls = await h.frameCalls();
  await captureStill(h, "fresh");
  for (const item of GAME_OVER_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `specs/modes.md: a Standard Game Over with no save offers ${item}`,
    );
  }
  assertEqual(
    drewText(calls, GAME_OVER_SAVE_ITEMS[0]),
    false,
    "specs/modes.md: there is no save to continue from",
  );
  assertEqual(
    await menuLength(h),
    GAME_OVER_ITEMS.length,
    "specs/ui.md: GAME_OVER_ITEMS is the whole of the menu",
  );
});
