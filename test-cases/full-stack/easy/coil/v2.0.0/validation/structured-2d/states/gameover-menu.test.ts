// states/gameover-menu — MENU from the game-over screen leaves for the title.
//
// specs/ui.md, on `gameover` and `cleared`: "`MENU` returns to `title`." `MENU`
// is the second item of `OVER_ITEMS`, and the highlight is posed onto it rather
// than pressed for, so a build whose highlight will not move fails
// `controls/menu-highlight-moves` alone. What is pressed here is `confirm`.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, OVER_ITEMS } from "../../src/constants";
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

/** `MENU` is the second item of `OVER_ITEMS` (specs/ui.md). */
const MENU_INDEX = OVER_ITEMS.indexOf("MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the screen to title on confirm at MENU", async () => {
  const over = poseScene(h, {
    screen: "gameover",
    menuIndex: MENU_INDEX,
    snake: chainFrom(HOME_HEAD, "right", 6),
    dir: "right",
    pellet: null,
    score: 180,
    best: 180,
  });
  assertEqual(over.menuIndex, MENU_INDEX, "the highlighted item");

  await h.tap(CONFIRM);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen MENU returned to from game over",
  );
});
