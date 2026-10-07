// screens/title-down-moves-highlight — one `down` press moves the title
// highlight down one item.
//
// THE RULE, `specs/ui.md`, Screens, `title`: "`up` and `down` move the highlight
// by one item and wrap at both ends." `specs/controls.md` says which key that is
// and that the title reads it: `down` is `ArrowDown`, "read as a press edge, once
// per press", and the title's row of What each screen reads is "`up` and `down`
// move the highlight; `confirm` takes it; `mute`."
//
// THE CONFIGURATION is the title as the game opens on it, where `menuIndex` is
// `0`, and ONE press of `down`. Nothing else is posed and no other key is
// pressed, so the move read back is that press's. The wrap at the bottom is
// `title-down-wraps`'s point; this one is the step in the middle of the menu,
// which is why it starts at the top.
//
// THE PRESS IS A REAL KEY. `pressAction` presses the `KeyboardEvent.code`
// `specs/controls.md` binds and runs the frame that delivers it, so what is being
// read is the game reading a key rather than a pose of the field it sets.
//
// THE VERDICT. `menuIndex` is `1` and the game is still on the title. A build
// that moved by more than one, or that moved the other way, is caught by the
// value; one that took the press as a `confirm` is caught by the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the highlight from the first item to the second", async () => {
  assertGreaterThan(
    TITLE_ITEMS.length,
    1,
    "TITLE_ITEMS carries more than one entry, so there is an item below the first",
  );

  await openTitle(h);
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the press this point reads is delivered on the title screen",
  );
  assertEqual(
    before.menuIndex,
    0,
    "the title opens with its first item highlighted, which is where the press starts",
  );

  const after = await pressAction(h, "down");
  await captureStill(h, "moved");

  assertEqual(
    after.screen,
    "title",
    "a down press moves the highlight rather than leaving the screen",
  );
  assertEqual(
    after.menuIndex,
    1,
    `one down press moves the highlight one item, from ${TITLE_ITEMS[0]} to ${TITLE_ITEMS[1]}`,
  );
});
