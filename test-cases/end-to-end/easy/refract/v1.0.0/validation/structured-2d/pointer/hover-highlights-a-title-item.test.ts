// Refract — pointer/hover-highlights-a-title-item: moving the pointer over a
// title item highlights it.
//
// specs/controls.md: a move within a `menu-<i>` target, with the pointer holding
// nothing, sets `menuIndex` to `i`. The move is aimed at the middle of the
// target the build itself reports, so the check follows the build's own layout
// rather than guessing where it drew the menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the highlight to the item the pointer is over", async () => {
  await resetTo(h);
  assertEqual(h.snapshot().menuIndex, 0, "the title opens with menuIndex 0");

  const last = targetCenter(targetById(h.snapshot(), "menu-2"));
  h.debug.pointerMove(last.x, last.y);
  await h.advance(1);

  assertEqual(
    h.snapshot().menuIndex,
    2,
    "a move within menu-2 highlights the third item " +
      "(specs/controls.md, Operating a screen with the pointer)",
  );
  assertEqual(h.snapshot().screen, "title", "hovering takes nothing");
  captureStill(h, "menu");

  const first = targetCenter(targetById(h.snapshot(), "menu-0"));
  h.debug.pointerMove(first.x, first.y);
  await h.advance(1);

  assertEqual(h.snapshot().menuIndex, 0, "and back again on a move to menu-0");
});
