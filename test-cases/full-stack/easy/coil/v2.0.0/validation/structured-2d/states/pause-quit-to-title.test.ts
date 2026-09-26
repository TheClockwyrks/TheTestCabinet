// states/pause-quit-to-title — MENU from the pause menu leaves for the title.
//
// specs/ui.md, on `paused`: "`MENU` returns to `title`." `MENU` is the third item
// of `PAUSE_ITEMS`, and the highlight is posed onto it rather than pressed for, so
// a build whose highlight will not move fails `controls/menu-highlight-moves`
// alone. What is pressed here is `confirm`.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The first key `specs/controls.md` binds to `confirm`. */
const CONFIRM = BINDINGS.confirm[0];

/** `MENU` is the third item of `PAUSE_ITEMS` (specs/ui.md). */
const MENU_INDEX = PAUSE_ITEMS.indexOf("MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the screen to title on confirm at MENU", async () => {
  const paused = poseScene(h, {
    screen: "paused",
    menuIndex: MENU_INDEX,
    snake: chainFrom(HOME_HEAD, "right", 5),
    dir: "right",
    pellet: null,
  });
  assertEqual(paused.menuIndex, MENU_INDEX, "the highlighted item");

  await h.tap(CONFIRM);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen MENU returned to from the pause menu",
  );
});
