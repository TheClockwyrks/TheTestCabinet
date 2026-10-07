// navigation/howto-menu-back — `menu-back` leaves the how-to screen.
//
// THE RULE. `specs/controls.md`, Menu navigation, the per-screen table: `howto` /
// `menu-confirm`, `menu-back` — "Activates the item labelled `HOWTO_BACK_LABEL`,
// as `specs/screens.md` states." `specs/screens.md` gives that item its effect:
// "Activating it returns to `title`."
//
// THE TWO ACTIONS ARE TWO POINTS, even though the screen gives them the same
// effect. `menu-back` is `Escape` alone, and it is the key a player who wants OUT
// of a screen reaches for first; a build that wired only `menu-confirm` leaves
// that player pressing a key that does nothing.
// `navigation/howto-menu-confirm` is the other half.
//
// THIS IS THE ONE SCREEN WHERE `menu-back` DOES ANYTHING. `specs/controls.md`
// makes it inert on the title and during play — `navigation/title-menu-back-inert`
// and `navigation/hud-menu-back-inert` are those points — so a build that treats
// Escape as a universal "go to title" passes here and fails both of those.
//
// THE SCREEN IS POSED DIRECTLY rather than reached from the title, so a build
// whose way IN is broken fails `screens/title-how-to-opens` rather than failing
// here as well.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MENU_BACK_KEY } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  pressKey,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title on Escape", async () => {
  openHowto(h);
  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: the screen before the press",
  );

  await pressKey(h, MENU_BACK_KEY);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "title");

  assertEqual(
    after.screen,
    "title",
    `the screen one press of ${MENU_BACK_KEY} reached from the how-to ` +
      `screen — menu-back activates the item labelled BACK ` +
      `(specs/controls.md), which returns to title (specs/screens.md)`,
  );
});
