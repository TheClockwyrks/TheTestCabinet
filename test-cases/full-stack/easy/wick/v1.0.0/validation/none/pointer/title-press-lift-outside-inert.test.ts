// pointer/title-press-lift-outside-inert — a pointer dragged off the item it
// pressed before it lifts takes nothing.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 2: "A primary press edge inside the rectangle of the item at `menuIndex`
// `i` sets `menuIndex` to `i` ... and arms that item. That press's release edge
// inside the same rectangle takes the armed item exactly as `confirm` on it
// does. A release edge anywhere else disarms it and takes nothing, so a pointer
// dragged off an item before it lifts takes nothing."
//
// WHY THIS IS A POINT OF ITS OWN. It is the edge case rule 2 states in its own
// words, and the only one that separates a build taking an item on the PRESS
// from one taking it on the RELEASE. A build that acts on the press passes every
// click point in this category — a click delivers both edges on one frame — and
// changes screen here, which is the whole of the difference for a player who
// pressed the wrong entry and slid off it.
//
// HOW THE SCENARIO IS DRIVEN. The primary button pressed at the middle of the
// third title item's rectangle, the pointer dragged to the middle of the first
// while it is held, and the button lifted there, a driven frame for each part.
// The two endpoints are both items, so a build that took whatever the LIFT fell
// on leaves the title too, and is caught here.
//
// WHAT IS READ. The screen and the highlight after the lift. A press moves the
// highlight, and nothing after it moves it back, so the item pressed is the one
// still selected.
//
// THE TOLERANCE. None: a screen name and a menu index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  glideTo,
  liftAt,
  pressAt,
  type Harness,
} from "../harness";
import { assertHighlight, menuPoints, poseTitle } from "./stage";

/** Where the press lands, and where the pointer is dragged before it lifts. */
const PRESSED = TITLE_ITEMS.indexOf("HOW TO PLAY");
const LIFTED = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes nothing when the pointer lifts outside the item it pressed", async () => {
  await poseTitle(h);
  const points = await menuPoints(h, TITLE_ITEMS.length, "for the title menu");

  const pressed = await pressAt(h, points[PRESSED]!);
  assertHighlight(pressed, "title", PRESSED, "under the press that armed it");

  await glideTo(h, points[LIFTED]!);
  const lifted = await liftAt(h);
  await captureStill(h, "lifted");

  assertHighlight(
    lifted,
    "title",
    PRESSED,
    "after the pointer lifted outside the item it pressed",
  );
});
