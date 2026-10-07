// screens/title-salvage — SALVAGE leads to the map select.
//
// THE REQUIREMENT. `specs/ui.md`, of the title's two entries: "`SALVAGE` leads to
// `mapselect` and `HOW TO PLAY` leads to `howto`." This is the first step of the
// only route into a run, so a build that draws the title and goes nowhere from it
// is unplayable from the front door.
//
// HOW IT IS DECIDED. The game is reset to the title and the SALVAGE entry is
// highlighted and taken. Which index that entry sits at is read off the build's
// own `menuButtons`, in the order it presents its choices, so nothing here
// assumes an ordering; the entry is then confirmed with a real browser key event
// through the build's own keyboard layer, and the screen is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openMenu,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves to the map select when SALVAGE is taken", async () => {
  await h.debug.reset();
  const entries = await openMenu(h, "title");
  const index = entries.findIndex((entry) => entry.action === "salvage");
  assertGreaterThanOrEqual(
    index,
    0,
    "the title to present a SALVAGE choice (specs/ui.md, " +
      "specs/instrumentation.md)",
  );

  await h.debug.setMenuIndex(index);
  await h.tap(keyFor("confirm"));
  await captureStill(h, "mapselect");

  assertEqual(
    (await h.snapshot()).screen,
    "mapselect",
    "the screen SALVAGE leads to from the title (specs/ui.md)",
  );
});
