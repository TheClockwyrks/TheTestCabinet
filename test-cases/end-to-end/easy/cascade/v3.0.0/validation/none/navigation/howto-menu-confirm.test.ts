// navigation/howto-menu-confirm — `menu-confirm` leaves the how-to screen.
//
// THE RULE. `specs/controls.md`, Menu navigation, the per-screen table: `howto` /
// `menu-confirm`, `menu-back` — "Activates the item labelled `HOWTO_BACK_LABEL`,
// as `specs/screens.md` states." `specs/screens.md` gives that item its effect:
// "The screen carries one control, labelled `HOWTO_BACK_LABEL` (`BACK`).
// Activating it returns to `title`."
//
// THE TWO ACTIONS ARE TWO POINTS, even though the screen gives them the same
// effect. `menu-confirm` and `menu-back` are separate bindings a build registers
// separately, and a build that wired one and not the other leaves a player who
// reaches for the other key stuck on a screen with nothing else on it.
// `navigation/howto-menu-back` is the `Escape` half.
//
// A KEY BOUND TO TWO CODES IS ONE POINT, so both `Enter` and `Space` are driven
// here from the same posed start.
//
// THE SCREEN IS POSED DIRECTLY rather than reached from the title, so a build
// whose way IN is broken fails `screens/title-how-to-opens` and
// `navigation/title-menu-confirm` rather than failing here as well.
//
// WHAT THIS DOES NOT DECIDE. Which entry the title comes back ON, which is
// `navigation/title-remembers-how-to`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MENU_CONFIRM_KEYS } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title on either confirm key", async () => {
  const read: { code: string; screen: string }[] = [];
  for (const code of MENU_CONFIRM_KEYS) {
    await openHowto(h);
    assertEqual(
      (await h.snapshot()).screen,
      "howto",
      `posing: the screen before the press of ${code}`,
    );

    await h.tap(code);
    read.push({ code, screen: (await h.snapshot()).screen });
  }

  await h.advance(1);
  await captureStill(h, "title");

  for (const step of read) {
    assertEqual(
      step.screen,
      "title",
      `the screen one press of ${step.code} reached from the how-to screen — ` +
        `confirm activates the item labelled BACK (specs/controls.md), which ` +
        `returns to title (specs/screens.md)`,
    );
  }
});
