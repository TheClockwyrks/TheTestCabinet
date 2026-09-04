// screens/title-highlights-salvage-from-a-run — quitting a run to the title
// highlights SALVAGE.
//
// THE REQUIREMENT. `specs/ui.md`'s table of what a menu opens on names the row:
// returning to `title` from "`QUIT TO MENU` on `paused`, or `MENU` on `victory` or
// `overload`" highlights `SALVAGE`. A player who has just left a run is being
// offered the entry that starts another one, and the rule is worth its own point
// because the route back is a run rather than a sibling menu.
//
// HOW IT IS DECIDED. A run is opened and its pause menu reached, `QUIT TO MENU` is
// found by the action it carries rather than by where it was drawn and taken at the
// centre of the rectangle the BUILD reported for it, and `menuIndex` is read back
// against the place `SALVAGE` holds in the entries the build reports for the title.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openMenu,
  openYard,
  pressMenu,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("highlights SALVAGE on the title a run was quit to", async () => {
  openYard(h);
  h.debug.setScreen("paused");

  await pressMenu(h, "quit");
  captureStill(h, "title");

  const back = h.snapshot();
  assertEqual(
    back.screen,
    "title",
    "the screen QUIT TO MENU returns to (specs/ui.md)",
  );

  const entries = openMenu(h, "title");
  const at = entries.findIndex((entry) => entry.action === "salvage");
  assertEqual(
    back.menuIndex,
    at,
    "the entry highlighted on a title reached by quitting a run (specs/ui.md)",
  );
});
