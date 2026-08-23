// Carom — ui/state-title: the title / main menu is the state the game opens in,
// and it draws the menu it is meant to.
//
// Two readings of the same frame. The game's own state says which screen it
// believes it is on, and the frame's draw calls say what it actually put on the
// canvas — so a build that reports a title it never draws, or draws one it does
// not report, fails here rather than passing on either half alone.
//
// The copy is the case's, from `src/constants.ts`, so this asserts the strings
// the specification fixes rather than any wording of the check's own. Matching is
// by substring, because a menu entry is commonly drawn with a selection marker
// beside it and that is a build's own presentation. Whether the screen lays out
// well is the reviewer's, from the capture.

import { afterEach, beforeEach, expect, it } from "vitest";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../../src/constants";
import {
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens on the title and draws its name, tagline, and menu", async () => {
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "title");

  expect(h.snapshot().screen).toBe("title");
  expect(drewText(h.calls, TITLE_TEXT)).toBe(true);
  expect(drewText(h.calls, TAGLINE_TEXT)).toBe(true);
  for (const item of TITLE_ITEMS) {
    expect(drewText(h.calls, item)).toBe(true);
  }
});
