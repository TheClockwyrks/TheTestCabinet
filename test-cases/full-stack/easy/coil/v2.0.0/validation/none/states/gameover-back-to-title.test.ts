// states/gameover-back-to-title — back on the game-over screen returns to the
// title.
//
// specs/ui.md gives `gameover` two ways off it that reach the title — `MENU` on
// the menu, and `back` — and states the second outright: "`back` returns to
// `title`." specs/controls.md gives the same action on a menu-bearing screen as
// "Leaves the screen for the one it was reached from". This point is the `back`
// route alone; the menu route is `states/gameover-menu`'s to decide.
//
// The round is ended by running the head into the wall, so the screen the key is
// pressed on is one the build's own step 3 opened.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  WALL_CELL,
  arrangeApproach,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the screen to title on back from game over", async () => {
  await arrangeApproach(h, WALL_CELL, { dir: "left" });
  const ended = await h.tick();
  assertEqual(ended.screen, "gameover", "the screen the key is pressed on");

  await h.tap(KEY.back);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen back reached from game over",
  );
});
