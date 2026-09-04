// controls/menu-horizontal-inert — left and right do nothing on a menu.
//
// specs/controls.md, on a menu-bearing screen: `left` does "Nothing", and so does
// `right`. Both are read, and both are read as leaving the highlight AND the
// screen where they found them — a menu whose entries answer a steering key
// surprises a player who has just come out of a round still holding one.
//
// The highlight is posed off the first item, so a build that resets it to `0` on
// any key at all is caught rather than passing on a menu that was already there.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The first key `specs/controls.md` binds to each horizontal action. */
const LEFT = BINDINGS.left[0];
const RIGHT = BINDINGS.right[0];

/** An item that is not the one a menu is arrived at on (specs/ui.md). */
const HIGHLIGHTED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the highlight and the screen untouched on left and on right", async () => {
  openTitle(h);
  h.debug.setMenuIndex(HIGHLIGHTED);

  await h.tap(LEFT);
  const afterLeft = h.snapshot();
  assertEqual(afterLeft.menuIndex, HIGHLIGHTED, "the highlight after left");
  assertEqual(afterLeft.screen, "title", "the screen after left");

  await h.tap(RIGHT);
  captureStill(h, "inert");
  const afterRight = h.snapshot();
  assertEqual(afterRight.menuIndex, HIGHLIGHTED, "the highlight after right");
  assertEqual(afterRight.screen, "title", "the screen after right");
});
