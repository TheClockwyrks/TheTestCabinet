// pointer/title-press-lift-outside-inert — a pointer dragged off the item it
// pressed before it lifts takes nothing.
//
// WHAT THIS DECIDES. One thing: the release outside the box the press armed
// takes nothing, and the pressed item is still the selected one.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 2: "A primary press edge
//   inside the rectangle of the item at `menuIndex` `i` sets `menuIndex` to `i`
//   ... and arms that item. That press's release edge inside the same rectangle
//   takes the armed item exactly as `confirm` on it does. A release edge
//   anywhere else disarms it and takes nothing, so a pointer dragged off an item
//   before it lifts takes nothing."
//
// WHY IT IS A POINT OF ITS OWN. It is the edge case rule 2 states in its own
// words, and the only one that separates a build taking an item on the PRESS
// from one taking it on the RELEASE: a click delivers both edges on one frame,
// so every other click point in this category passes either way.
//
// THE DRIVE. The title through `setScreen`, the primary button pressed at the
// middle of the third item's rectangle, a move carrying the primary mask to the
// middle of the first, and the button lifted there, a frame each. Both endpoints
// are items, so a build that took whatever the lift fell on leaves the title
// too.
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
  glideToWithoutTick,
  liftAtWithoutTick,
  menuRectAt,
  pressRectWithoutTick,
} from "./pointing";

/** Where the press lands, and where the pointer is dragged before it lifts. */
const PRESSED = TITLE_ITEMS.indexOf("HOW TO PLAY");
const LIFTED = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes nothing when the pointer lifts outside the item it pressed", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the press lands on");

  const pressed = await pressRectWithoutTick(
    h,
    menuRectAt(h, PRESSED, "the HOW TO PLAY item"),
  );
  assertEqual(pressed.menuIndex, PRESSED, "the highlight the press moved");
  assertEqual(pressed.screen, "title", "the screen the press alone left");

  const away = centerOf(menuRectAt(h, LIFTED, "the LIGHT THE LAMP item"));
  await glideToWithoutTick(h, away.x, away.y);
  const after = await liftAtWithoutTick(h, away.x, away.y);
  captureStill(h, "lifted");

  assertEqual(after.screen, "title", "the screen the gesture left");
  assertEqual(
    after.menuIndex,
    PRESSED,
    "the item the press armed, still selected",
  );
});
