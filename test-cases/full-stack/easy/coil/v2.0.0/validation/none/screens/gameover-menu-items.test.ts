// screens/gameover-menu-items — the game-over screen draws its menu.
//
// specs/ui.md tables `gameover` with a Menu, `OVER_ITEMS` (`PLAY AGAIN`, `MENU`),
// and both entries are the one element: a menu is what it offers, and a screen
// showing one of two ways off it is a screen a player is half stuck on. The other
// three elements of the table are their own points.
//
// The round is ended by running the head into the wall, so the screen read is one
// the build's own step 3 opened rather than one this point posed.
//
// Matching is by substring and ignores case, because how a build sets its copy is
// its own: a heading is commonly drawn with padding around it and a menu entry
// with a selection marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { OVER_ITEMS } from "../constants";
import {
  WALL_CELL,
  arrangeApproach,
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every item of OVER_ITEMS", async () => {
  await arrangeApproach(h, WALL_CELL, { dir: "left" });
  const ended = await h.tick();
  assertEqual(ended.screen, "gameover", "the screen the frame is read from");

  const calls = await h.frameCalls();
  await captureStill(h, "gameover");

  for (const item of OVER_ITEMS) {
    assertEqual(drewText(calls, item), true, `the menu drawing ${item}`);
  }
});
