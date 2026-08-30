// Refract — screens/pointer-ignores-menus: a press and release on the title
// menu's drawn items changes nothing.
//
// specs/ui.md "Menu navigation": "Menus are keyboard only … The pointer draws
// beams and does not operate menus." So the real mouse is pressed and released
// ON each menu item, where a pointer-driven menu would take the click, and the
// screen and the highlight must both stand still.
//
// Where each item is drawn is read from the frame's own text draws, coalesced
// into logical runs and mapped through the transform in force at each call, so
// the press lands on the item wherever the build's layout put it. A run rather
// than a raw draw, because canvas exposes no portable letter-spacing and a
// build that tracks its menu copy draws a glyph per call, which would leave
// this check a one-glyph box to press instead of the item; specs/ui.md fixes
// the copy of a menu item, and how it is spaced is the build's. Finding the
// items drawn at all is this check's precondition — the title's copy has its
// own point — and a build whose title never draws its menu fails that
// precondition by name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextRuns,
  mousePress,
  mouseRelease,
  type Harness,
  type TextDraw,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Where `item` is drawn on the frame, by its anchor. */
function anchorOf(draws: readonly TextDraw[], item: string): TextDraw {
  const found = draws.find((draw) =>
    draw.text.toUpperCase().includes(item.toUpperCase()),
  );
  if (found === undefined) {
    fail(
      `the title frame draws the menu item "${item}" (specs/ui.md TITLE_ITEMS)`,
      draws.map((draw) => draw.text),
    );
  }
  return found;
}

it("leaves screen and menuIndex unchanged by a press on each item", async () => {
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title");
  assertEqual(opened.menuIndex, 0, "menuIndex is 0 on arriving at the title");

  const draws = drawnTextRuns(await h.frameCalls());

  for (const item of TITLE_ITEMS) {
    const at = anchorOf(draws, item);
    await mousePress(h, at.x, at.y);
    await mouseRelease(h);

    const after = await h.snapshot();
    assertEqual(after.screen, "title", `screen after a click on "${item}"`);
    assertEqual(after.menuIndex, 0, `menuIndex after a click on "${item}"`);
  }

  await captureStill(h, "title");
});
