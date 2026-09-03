// Carom — ui/state-title: the title is the screen the game opens on, and it
// draws the copy the specification fixes for it.
//
// Two readings of the same frame. The game's own state says which screen it
// believes it is on, and the frame's draw calls say what it actually put on the
// canvas, so a build that reports a title it never draws, or draws one it does
// not report, fails here rather than passing on either half alone.
//
// The screen is posed by `openTitle`, which is `reset`: the one operation that
// restores every declared field to its title value (specs/state.md), which is
// exactly the state specs/overview.md says the game opens in.
//
// The field is left as that title state holds it. Nothing advances on `title`
// (specs/ui.md), no ball and no obstacle can draw a run of text, and specs/ui.md
// lets the furniture show dimmed behind the menu — so there is nothing here to
// remove, and a title emptied of it would be a screen the specification never
// describes and a still that misrepresents what a reviewer is grading. Nothing
// takes a paddle: a menu is not driven through one.
//
// The copy is the case's own: TITLE_TEXT and every entry of TITLE_ITEMS from
// `validation/constants.ts`, which states what specs/ui.md fixes. Matching is by
// substring, because a menu entry is commonly drawn with a selection marker
// beside it. Everything else about the screen is the build's, rated through the
// domains.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS, TITLE_TEXT } from "../constants";
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

it("opens on the title and draws its name and menu", async () => {
  openTitle(h);
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(drewText(h.calls, TITLE_TEXT), true);
  for (const item of TITLE_ITEMS) {
    assertEqual(drewText(h.calls, item), true);
  }
});
