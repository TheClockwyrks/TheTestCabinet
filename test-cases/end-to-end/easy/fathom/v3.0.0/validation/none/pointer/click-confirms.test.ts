// pointer/click-confirms — a press and a release inside one item confirms it.
//
// specs/ui.md, "Pointer and touch": "A pointer is pressed and released inside one
// item's region" makes that item the selected one AND confirms it, and what
// confirming does is "what the transition table above gives that item". On the
// title, `HOW TO PLAY` confirmed sets `screen = howto` — so the screen the click
// leaves is the whole reading, and it is a reading the pointer alone can produce.
//
// THE SELECTION IS POSED ON A DIFFERENT ITEM. The title is posed on `DIVE` and the
// click lands on `HOW TO PLAY`: a build that confirmed the standing selection
// instead of the one under the pointer opens a countdown and fails, rather than
// passing because it happened to confirm something.
//
// Both edges fall inside the one region `menuItemRect` reports, which is what
// specs/ui.md requires of a confirm; the press and the release run a driven frame
// each, so a build that reads its pointer once a frame sees both. Where the item
// sits is the build's own and is never guessed.
//
// Nothing advances on `"title"` or on `"howto"` (specs/ui.md), so the gesture
// runs over a world that cannot move under it.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickItem,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DIVE = TITLE_ITEMS.indexOf("DIVE");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms the item a click presses and releases inside", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(DIVE);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the gesture is made on");
  assertEqual(posed.menuIndex, DIVE, "the posed title selection");

  await clickItem(h, HOWTO);
  // Before the assertion, so a failing check still leaves the screen it read.
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen a press and a release inside HOW TO PLAY's own region " +
      "confirms to (specs/ui.md)",
  );
});
