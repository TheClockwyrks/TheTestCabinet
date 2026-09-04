// screens/title-highlights-howto-on-return — returning from How To Play highlights
// HOW TO PLAY.
//
// THE REQUIREMENT. `specs/ui.md`: "Returning to a menu highlights the entry that led
// away from it", and its table names this row exactly — returning to `title` from
// `howto` highlights `HOW TO PLAY`. It is what lets a player read the rules and then
// carry on down the menu from where they were, instead of being put back at the top.
//
// HOW IT IS DECIDED. How To Play is opened directly, so a build with a broken title
// menu still has this point decided on its own terms, and its `BACK` choice is
// taken. `menuIndex` is read back against the place `HOW TO PLAY` holds in the
// entries the BUILD reports for the title, so where the build draws its menu and
// what it calls the entry internally are both left alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openMenu,
  pressMenu,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("highlights HOW TO PLAY on the title returned to from How To Play", async () => {
  h.debug.reset();
  openMenu(h, "howto");

  await pressMenu(h, "back");
  captureStill(h, "title");

  const back = h.snapshot();
  assertEqual(back.screen, "title", "the screen BACK returns to (specs/ui.md)");

  const entries = openMenu(h, "title");
  const at = entries.findIndex((entry) => entry.action === "howto");
  assertEqual(
    back.menuIndex,
    at,
    "the entry highlighted on a title returned to from How To Play, which is " +
      "the entry that led away from it (specs/ui.md)",
  );
});
