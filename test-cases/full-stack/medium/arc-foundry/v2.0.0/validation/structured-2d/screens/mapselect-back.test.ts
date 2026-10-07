// screens/mapselect-back — the map select's BACK returns to the title.
//
// THE REQUIREMENT. `specs/ui.md`, of `mapselect`: "A `BACK` choice returns to
// `title`." It is the way out of a choice a player has changed their mind about,
// and `specs/ui.md` makes every menu "fully operable with the pointer alone", so
// the choice is taken here the way the pointer takes one.
//
// HOW IT IS DECIDED. The map select is opened directly, through the operation that
// reaches a screen "exactly as reaching it in play does", so a build with a broken
// title menu still has this point decided on its own terms. The BACK choice is
// found by the action it carries rather than by where it was drawn, and pressed at
// the centre of the rectangle the build itself reported for it. The screen is read
// back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openMenu,
  pressMenu,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to the title when BACK is taken from the map select", async () => {
  h.debug.reset();
  openMenu(h, "mapselect");

  await pressMenu(h, "back");
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the map select's BACK choice returns to (specs/ui.md)",
  );
});
