// screens/back-from-howto — Escape on the how-to screen goes back to the title.
//
// THE RULE. specs/screens.md's `howto` section: "`back` returns to `title`."
// specs/controls.md binds `back` to `Escape`, and on a screen with nothing armed
// and nothing selected the press resolves on the screen itself.
//
// THE HOW-TO SCREEN HAS NO MENU, which is what makes this item worth its own
// check: it is the one screen a player can reach and be stuck on, because there is
// no row to confirm and `back` is the only way off it. specs/screens.md gives it
// one destination, and it is the screen it was opened from.
//
// WHAT THE SCREEN CONTAINS is `screens.howto-content`'s requirement and how it is
// reached is `screens.title-to-howto`'s. This item is the way back, so the screen
// is posed outright and one press is made — `setScreen` runs no entry effect
// (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual, assertNull } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `back` to. */
const BACK = BINDINGS.back[0];

/** The how-to screen has no menu, so the highlight it is posed with is `0`. */
const NO_MENU_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the how-to screen", async () => {
  poseMenu(h, "howto", NO_MENU_ROW);
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "howto",
    "posing: the screen the press is made on (specs/screens.md)",
  );
  assertNull(
    before.build,
    "posing: nothing is armed, so `back` resolves on the screen " +
      "(specs/controls.md)",
  );
  assertNull(
    before.selected,
    "posing: nothing is selected, so `back` resolves on the screen " +
      "(specs/controls.md)",
  );

  await h.tap(BACK);
  captureStill(h, "back");

  assertEqual(
    h.snapshot().screen,
    "title",
    `${BACK} on the how-to screen: the screen behind it (specs/screens.md)`,
  );
});
