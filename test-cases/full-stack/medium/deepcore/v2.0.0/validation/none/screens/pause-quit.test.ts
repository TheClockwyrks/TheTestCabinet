// screens/pause-quit — QUIT TO MENU leaves the expedition for the title.
//
// specs/ui.md: on `paused`, "`QUIT TO MENU` returns to `title`". It is the third
// and last of `PAUSE_ITEMS`, and it is the one pause entry that leaves the
// expedition rather than continuing or restarting it.
//
// THE TITLE IS READ AS A MENU, not just as a name. After the quit the game is on
// the title screen and its menu is the one specs/ui.md lists for the slot as it
// stands — two entries with nothing banked — so a build that set the screen field
// without leaving the mine behind is caught on the menu it draws there.
//
// ISOLATION. An empty mine with the slot cleared first, and the pause menu
// reached directly through the surface, because a build with a broken pause key
// and a working QUIT must pass this and fail that one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS, TITLE_ITEMS_NO_SAVE, TITLE_TEXT } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  drewText,
  openScene,
  type Harness,
} from "../harness";
import { menuLength } from "../save/expedition";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title screen and its menu", async () => {
  await openScene(h);
  await h.debug.clearSave();

  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(PAUSE_ITEMS.indexOf("QUIT TO MENU"));
  await h.tap(ACTION_KEY.activate);

  const calls = await h.frameCalls();
  await captureStill(h, "quit");
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "specs/ui.md: QUIT TO MENU returns to the title",
  );
  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `specs/ui.md: the title screen shows TITLE_TEXT (${TITLE_TEXT})`,
  );
  assertEqual(
    await menuLength(h),
    TITLE_ITEMS_NO_SAVE.length,
    "specs/ui.md: the title menu is the one the empty slot leaves",
  );
});
