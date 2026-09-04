// screens/title-howto-entry — the title screen draws the how-to entry of its menu.
//
// specs/ui.md's `title` table gives the screen a Menu, `TITLE_ITEMS`, holding
// "The mode's entry, then `HOW TO PLAY`". The mode's entry is stated per mode and
// decided by `screens/title-mode-entry-*`; the second item is the same word under
// either mode, and it is this point.
//
// Matching is by substring and ignores case, because how a build sets its copy is
// its own: a heading is commonly drawn with padding around it and a menu entry
// with a selection marker beside it. What is required is that the words are on
// the screen.
//
// The title is reached by resetting rather than by pressing anything, so a build
// whose menus do not work still has this point decided on what it draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the how-to entry of its menu", async () => {
  const title = await openTitle(h);
  assertEqual(title.screen, "title", "the screen the frame is read from");

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual(
    drewText(calls, HOWTO_ITEM),
    true,
    `the title drawing ${HOWTO_ITEM}`,
  );
});
