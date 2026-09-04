// screens/overload-menu — the overload screen's MENU returns to the title.
//
// THE REQUIREMENT. `specs/ui.md`, of `overload`: "It offers `TRY AGAIN` and `MENU`,
// leading to the same places" as the victory screen's two choices, and `MENU` there
// "returns to `title`". A defeated player is the one most likely to want out, and
// this is the choice that lets them.
//
// HOW IT IS DECIDED. The overload screen is reached directly, through the operation
// that reaches a screen "exactly as reaching it in play does", because what is being
// decided is where a choice leads rather than how the screen was arrived at. `MENU`
// is found by the action it carries rather than by where it was drawn, and taken at
// the centre of the rectangle the build itself reported for it. The screen is read
// back.

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

it("returns to the title when MENU is taken from the overload screen", async () => {
  h.debug.reset();
  openMenu(h, "overload");

  await pressMenu(h, "menu");
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the overload screen's MENU choice returns to (specs/ui.md)",
  );
});
