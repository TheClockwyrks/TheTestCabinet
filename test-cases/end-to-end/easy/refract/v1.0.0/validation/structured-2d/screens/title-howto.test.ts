// Refract — screens/title-howto: confirming HOW TO PLAY on the title opens the
// how-to screen with menuIndex 0.
//
// One transition of the menu state machine specs/ui.md fixes: `confirm` on
// `HOW TO PLAY` sets `screen = howto` and `menuIndex = 0`. The third item is
// reached the plain way — one down per step from the fresh title's 0 — and the
// arrival is asserted before the confirm, so a menu that cannot reach the item
// fails on the precondition it breaks, not on the transition. Every press is
// the action's own bound key, dispatched as a real key event at the target the
// engine listens on (menus are keyboard only, specs/ui.md). The still is the
// how-to screen the confirm landed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to screen from the third title item", async () => {
  await resetTo(h);
  assertEqual(TITLE_ITEMS[2], "HOW TO PLAY");
  await tapAction(h, "down");
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    2,
    "the selection rests on HOW TO PLAY before the confirm",
  );

  await tapAction(h, "confirm");
  captureStill(h, "howto");

  assertEqual(h.snapshot().screen, "howto", "confirm opens the how-to screen");
  assertEqual(h.snapshot().menuIndex, 0, "the how-to screen opens at 0");
});
