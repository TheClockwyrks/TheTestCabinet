// controls/menu-highlight-moves — down moves the highlight on one item.
//
// specs/controls.md, on a menu-bearing screen: `down` "Moves the highlight down
// one item, wrapping at the ends." specs/ui.md makes `menuIndex` the highlighted
// item and sets it to `0` on arriving at the screen, so one press of `down` from
// a freshly opened title lands on item `1`.
//
// Exactly one press, and exactly one item: a build that moved the highlight two
// at a time, or that jumped to the end of the menu, fails here. That the
// highlight WRAPS at the ends is `controls/menu-highlight-wraps`.
//
// The title is opened by resetting, so the highlight starts where specs/ui.md
// says it starts and nothing but the one press has moved it.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The first key `specs/controls.md` binds to `down`. */
const DOWN = BINDINGS.down[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title highlight from the first item to the second", async () => {
  const title = openTitle(h);
  assertEqual(title.screen, "title", "the screen the key is pressed on");
  assertEqual(title.menuIndex, 0, "the highlighted item before the press");

  await h.tap(DOWN);
  captureStill(h, "moved");

  const moved = h.snapshot();
  assertEqual(moved.menuIndex, 1, "the highlighted item after one down");
  assertEqual(moved.screen, "title", "the screen after the press");
});
