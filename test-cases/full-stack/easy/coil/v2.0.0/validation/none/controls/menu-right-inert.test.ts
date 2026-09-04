// controls/menu-right-inert — right does nothing on a menu.
//
// specs/controls.md, on a menu-bearing screen: `right` does "Nothing". The
// other horizontal action is `controls/menu-left-inert`, and they are two
// points because they are two bindings: a build that swallows one and answers the
// other is a build a player finds half-surprising.
//
// BOTH THE HIGHLIGHT AND THE SCREEN are read, because "nothing" is a claim about
// the whole screen: a menu whose entries answer a steering key surprises a player
// who has just come out of a round still holding one, and one that leaves the
// screen is worse.
//
// The highlight is posed off the first item, so a build that resets it to `0` on
// any key at all is caught rather than passing on a menu that was already there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** An item that is not the one a fresh session arrives at the title on. */
const HIGHLIGHTED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the highlight and the screen untouched on right", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(HIGHLIGHTED);

  await h.tap(KEY.right);
  await captureStill(h, "inert");

  const after = await h.snapshot();
  assertEqual(after.menuIndex, HIGHLIGHTED, "the highlight after right");
  assertEqual(after.screen, "title", "the screen after right");
});
