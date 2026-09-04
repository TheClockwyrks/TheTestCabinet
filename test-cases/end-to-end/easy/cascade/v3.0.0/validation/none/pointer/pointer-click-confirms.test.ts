// pointer/pointer-click-confirms — a press and its release inside one item's
// region activate that item.
//
// THE RULE. `specs/controls.md`, Menu navigation, Pointer and touch: "A press and
// the release that follows it both land inside one item's region | `menuIndex`
// becomes that item's index, and the item is activated." The same file's gesture
// section says it again: "Either kind of gesture activates a control when one
// control's hit region holds both the press point and the release point."
//
// THE REGION IS THE BUILD'S OWN AND IS ASKED FOR, so the press and the release
// are made at the middle of what `menuItemRect(TITLE_HOW_TO_ITEM)` answered with
// and any layout passes.
//
// THE ITEM IS THE SECOND ONE, whose effect a check reads straight off `screen`:
// `specs/screens.md` has `HOW TO PLAY` move to `howto`, and the item beside it
// deals a fresh game and reaches `playing`. So a build that activates whatever
// item it likes lands on a different screen rather than agreeing by accident.
//
// THE GESTURE IS A REAL CHROMIUM MOUSE, so what is graded is the build's own
// input path rather than a posed pointer.
//
// THE CAP IS `broken` BECAUSE CASCADE IS A POINTER GAME: a build whose menus do
// not answer the mouse cannot be played as intended, whatever its keyboard does.
//
// WHAT THIS DOES NOT DECIDE. What the KEYBOARD's confirm does, which is
// `navigation/title-menu-confirm`'s, nor what a gesture split across two regions
// does, which is `pointer/pointer-split-gesture-confirms-nothing`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO_ITEM, TITLE_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  clickItem,
  createHarness,
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

it("activates the item both edges of the gesture landed in", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(TITLE_NEW_GAME_ITEM);
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "posing: the screen the gesture is made on",
  );

  await clickItem(h, TITLE_HOW_TO_ITEM);
  const after = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a click that reached the wrong screen still leaves
  // the picture of it.
  await captureStill(h, "howto");

  assertEqual(
    after.screen,
    "howto",
    `the screen a press and release inside the region the build reports for ` +
      `item ${TITLE_HOW_TO_ITEM} of the title's menu reached — one region ` +
      `holding both edges activates that item (specs/controls.md), and HOW TO ` +
      `PLAY moves to howto (specs/screens.md)`,
  );
});
