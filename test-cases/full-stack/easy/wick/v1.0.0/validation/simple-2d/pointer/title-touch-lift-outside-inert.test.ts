// pointer/title-touch-lift-outside-inert — a contact lifting outside the
// rectangle it landed in leaves that item selected and takes nothing.
//
// WHAT THIS DECIDES. One thing: the lift outside the landing's rectangle takes
// nothing, and the landing's item is still the selected one.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 3: "a contact lifting
//   outside the rectangle it landed in leaves that item selected and takes
//   nothing."
//
// WHY IT IS A POINT OF ITS OWN. It is the edge case the touch rule states in
// its own words, and the one a player relies on to change their mind: a finger
// that lands on the wrong entry and slides off must take nothing. A build that
// acts on the landing rather than on the lift passes every tap point and fails
// here, and so does one that takes whatever the lift fell on — both endpoints
// are items, so either mistake leaves the title.
//
// THE DRIVE. The title through `setScreen`, a contact landing at the middle of
// the third item's rectangle, a move carrying the primary mask to the middle of
// the first, and a lift there, a frame each.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
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
  touchLiftAtWithoutTick,
} from "./pointing";

/** Where the contact lands, and where it lifts: two different items. */
const LANDED = TITLE_ITEMS.indexOf("HOW TO PLAY");
const LIFTED = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes nothing when the contact lifts outside the item it landed in", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the contact lands on");

  await touchLandRectWithoutTick(
    h,
    menuRectAt(h, LANDED, "the HOW TO PLAY item"),
  );
  const away = centerOf(menuRectAt(h, LIFTED, "the LIGHT THE LAMP item"));
  await touchGlideToWithoutTick(h, away.x, away.y);
  const after = await touchLiftAtWithoutTick(h, away.x, away.y);
  captureStill(h, "lifted");

  assertEqual(after.screen, "title", "the screen the contact left");
  assertEqual(
    after.menuIndex,
    LANDED,
    "the item the contact landed in, still selected",
  );
});
