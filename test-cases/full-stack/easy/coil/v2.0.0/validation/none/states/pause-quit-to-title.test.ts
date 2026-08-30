// states/pause-quit-to-title — MENU from the pause menu leaves for the title.
//
// specs/ui.md, on `paused`: "`MENU` returns to `title`." `MENU` is the third item
// of `PAUSE_ITEMS`, and the highlight is posed onto it rather than pressed for, so
// a build whose highlight will not move fails `controls/menu-highlight-moves`
// alone. What is pressed here is `confirm`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY, PAUSE_ITEMS } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** `MENU` is the third item of `PAUSE_ITEMS` (specs/ui.md). */
const MENU_INDEX = PAUSE_ITEMS.indexOf("MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the screen to title on confirm at MENU", async () => {
  const paused = await poseScene(h, {
    screen: "paused",
    menuIndex: MENU_INDEX,
    snake: chainFrom(HOME_HEAD, "right", 5),
    dir: "right",
    pellet: null,
  });
  assertEqual(paused.menuIndex, MENU_INDEX, "the highlighted item");

  await h.tap(KEY.confirm);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen MENU returned to from the pause menu",
  );
});
