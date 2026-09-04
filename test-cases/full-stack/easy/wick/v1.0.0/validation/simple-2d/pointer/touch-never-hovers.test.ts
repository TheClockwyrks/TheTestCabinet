// pointer/touch-never-hovers — a contact travelling across another item's
// rectangle does not move the highlight onto it.
//
// WHAT THIS DECIDES. One thing: a position reported while the pointer is IN
// contact does not hover. That the LIFT outside the landing's rectangle takes
// nothing is `pointer/title-touch-lift-outside-inert`'s.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 1: "A touch contact never
//   hovers: only a device reporting a position while out of contact moves the
//   highlight this way."
//
// WHY IT IS A POINT OF ITS OWN. A build that feeds a contact's position into
// the hover rule looks right for a tap, because a landing selects what it lands
// in anyway, and is wrong the moment the finger travels: the highlight follows
// it and the lift then takes an item the player never chose.
//
// THE DRIVE. The title through `setScreen`, a contact landing at the middle of
// the second item's rectangle, and a move carrying the primary mask to the
// middle of the first. No lift, so the reading is of the travel and of nothing
// else.
//
// THE TOLERANCE. None: a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  centerOf,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import {
  menuRectAt,
  touchGlideToWithoutTick,
  touchLandRectWithoutTick,
} from "./pointing";

/** Where the contact lands, and the item it travels over afterwards. */
const LANDED = 1;
const CROSSED = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the highlight where the contact landed while it travels", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the contact lands on");

  const landed = await touchLandRectWithoutTick(
    h,
    menuRectAt(h, LANDED, "the second title item"),
  );
  assertEqual(landed.menuIndex, LANDED, "the highlight the landing moved");

  const crossed = centerOf(menuRectAt(h, CROSSED, "the first title item"));
  const after = await touchGlideToWithoutTick(h, crossed.x, crossed.y);
  captureStill(h, "held");

  assertEqual(
    after.menuIndex,
    LANDED,
    "the highlight after the contact travelled over another item",
  );
  assertEqual(after.screen, "title", "the screen the travel left");
});
