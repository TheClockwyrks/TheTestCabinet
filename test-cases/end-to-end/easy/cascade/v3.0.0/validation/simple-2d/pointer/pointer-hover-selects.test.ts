// pointer/pointer-hover-selects — moving the mouse onto an item's region selects
// that item.
//
// THE RULE. `specs/controls.md`, Menu navigation, Pointer and touch: "A mouse
// moves onto an item's region, its button up or down | `menuIndex` becomes that
// item's index."
//
// THE REGION IS THE BUILD'S OWN AND IS ASKED FOR. `specs/controls.md` leaves each
// item's hit region to the build and `specs/instrumentation.md` has the build
// report it, so the mouse is moved to the middle of what
// `menuItemRect(TITLE_HOW_TO_ITEM)` answered with. Any layout passes, and a build
// that reports a region it does not answer on fails.
//
// THE GESTURE GOES THROUGH THE ENGINE'S OWN POINTER, not a posed `pointerMove`.
// This project builds the engine in process, so the move is delivered as a
// sample of the frame the build reads, which is the path a player's mouse takes
// under this engine. `touch/touch-landing-selects` is the finger's point; the
// engine resolves a contact into the same samples, so what separates the two
// here is that a contact has no hover before it lands.
//
// THE CAP IS `scuffed`. `specs/controls.md` does not make activation wait on a
// hover — a press and the release that follows it inside one region select the
// item and activate it — so a build that never highlights on the way past is
// still playable with the mouse, and merely unpleasant.
//
// THE SELECTION STARTS ON THE OTHER ITEM, so a build that never moves the
// selection reads `0` where this point requires `1`, and cannot agree by
// accident. The screen is read as well, because a build that treated a hover as
// an activation would leave the title.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO_ITEM, TITLE_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  hoverItem,
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

it("selects the item the mouse moves onto", async () => {
  openTitle(h);
  h.debug.setMenuIndex(TITLE_NEW_GAME_ITEM);
  assertEqual(
    h.snapshot().menuIndex,
    TITLE_NEW_GAME_ITEM,
    "posing: menuIndex before the move — a selection already on the item " +
      "below would let this point pass on a menu that never answered",
  );

  await hoverItem(h, TITLE_HOW_TO_ITEM);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a menu that did not answer still leaves the
  // picture of the selection it kept.
  captureStill(h, "menu");

  assertEqual(
    after.menuIndex,
    TITLE_HOW_TO_ITEM,
    `menuIndex after the mouse moved onto the region the build reports for ` +
      `item ${TITLE_HOW_TO_ITEM} of the title's menu — a mouse moved onto an ` +
      `item's region selects that item (specs/controls.md)`,
  );
  assertEqual(
    after.screen,
    "title",
    "the screen that move left, which a hover does not change " +
      "(specs/controls.md)",
  );
});
