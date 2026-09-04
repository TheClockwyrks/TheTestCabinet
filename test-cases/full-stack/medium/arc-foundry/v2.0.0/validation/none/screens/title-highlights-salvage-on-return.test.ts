// screens/title-highlights-salvage-on-return — returning from the map select
// highlights SALVAGE.
//
// THE REQUIREMENT. `specs/ui.md`: "Returning to a menu highlights the entry that led
// away from it", and its table names this row exactly — returning to `title` from
// `mapselect` highlights `SALVAGE`. `SALVAGE` is what led to the map select, so a
// player who changed their mind about which map to play is put back on the entry
// they came through rather than somewhere else.
//
// HOW IT IS DECIDED. The map select is opened directly, so a build with a broken
// title menu still has this point decided on its own terms, and its `BACK` choice is
// taken. `menuIndex` is read back against the place `SALVAGE` holds in the entries
// the BUILD reports for the title.

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

afterEach(async () => {
  await h.dispose();
});

it("highlights SALVAGE on the title returned to from the map select", async () => {
  await h.debug.reset();
  await openMenu(h, "mapselect");

  await pressMenu(h, "back");
  await captureStill(h, "title");

  const back = await h.snapshot();
  assertEqual(back.screen, "title", "the screen BACK returns to (specs/ui.md)");

  const entries = await openMenu(h, "title");
  const at = entries.findIndex((entry) => entry.action === "salvage");
  assertEqual(
    back.menuIndex,
    at,
    "the entry highlighted on a title returned to from the map select, which " +
      "is the entry that led away from it (specs/ui.md)",
  );
});
