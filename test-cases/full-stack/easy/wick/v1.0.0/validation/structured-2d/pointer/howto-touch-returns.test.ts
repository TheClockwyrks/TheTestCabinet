// Wick — pointer/howto-touch-returns: a contact landing and lifting inside the
// how-to screen's one box returns to the title.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 3: "A touch contact landing inside a rectangle is that
// rectangle's press edge and lifting is its release edge, so a contact landing
// and lifting inside the rectangle ... takes it exactly as `confirm` on it
// does", with the screen's own paragraph fixing that taking `howto`'s box "does
// what `back` on `howto` ... does". `specs/ui.md`, "Menu navigation": `howto`
// and `chest` "each is left by the keyboard, the pointer, and touch alike".
//
// WHY THIS IS ITS OWN POINT. A player on a touch device reaches How To Play
// from the title, which answers a contact, so a build that answers no contact
// here strands them. The mouse's route is `pointer/howto-click-returns`'.
//
// THE DRIVE. `setScreen("howto")`, the box read back off `menuRects`, and a
// contact landing at the middle of it and lifting there, a frame each. The
// events are the ones a finger produces: a `pointerdown` naming `touch` with no
// move before it, and a `pointerup` naming `touch`.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRects,
  poseScreen,
  touchTapRect,
  type Harness,
} from "../harness";

/** The entry `back` on the how-to screen returns to. */
const HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to the title with HOW TO PLAY selected when the box is tapped", async () => {
  h.reset();
  const howto = poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "the screen the contact lands on");

  const rects = menuRects(h);
  assertLength(rects, 1, "the how-to screen's one box (specs/controls.md)");

  const after = await touchTapRect(h, rects[0]);
  captureStill(h, "returned");

  assertEqual(after.screen, "title", "the screen the contact left");
  assertEqual(
    after.menuIndex,
    HOW_TO_PLAY,
    "the title entry selected on returning from the how-to screen",
  );
});
