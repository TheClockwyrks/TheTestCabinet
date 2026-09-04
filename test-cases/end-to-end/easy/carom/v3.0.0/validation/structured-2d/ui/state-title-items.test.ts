// Carom — ui/state-title-items: the title screen draws its menu.
//
// Two readings of the same frame. The game's own state says which screen it
// believes it is on, and the frame's draw calls say what it actually put on the
// canvas, so a build that reports a title whose entries it never draws fails
// here rather than passing on either half alone.
//
// The screen is posed by `openTitle`, which is `reset`: the one operation that
// restores every declared field to its title value (specs/state.md). The frame
// that is READ is a second one, advanced with the call list cleared, so what is
// inspected is one whole render of the settled screen.
//
// Nothing on the field is posed or removed. Nothing advances on `title`
// (specs/ui.md), no ball and no obstacle can draw a run of text, and specs/ui.md
// lets the furniture show dimmed behind the menu — so there is nothing here to
// remove, and a title emptied of it would be a screen the specification never
// describes. Nothing takes a paddle: a menu is not driven through one.
//
// The copy is the case's own: every entry of TITLE_ITEMS from
// `validation/constants.ts`, which states what specs/ui.md fixes. Matching is by
// substring, because a menu entry is commonly drawn with a selection marker
// beside it.
//
// SPLIT FROM `ui/state-title`, which reads the heading. A build that draws the
// menu but no heading is not the same build as one that draws neither: a player
// who cannot see the entries is choosing between them blind, where a title
// screen missing the word CAROM still reads as a menu and still works.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
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

afterEach(() => {
  h?.dispose();
});

it("draws every entry of the title menu", async () => {
  await openTitle(h);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "menu");

  assertEqual(h.snapshot().screen, "title");
  for (const item of TITLE_ITEMS) {
    assertEqual(drewText(h.calls, item), true);
  }
});
