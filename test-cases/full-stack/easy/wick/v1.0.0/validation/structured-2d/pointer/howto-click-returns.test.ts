// Wick — pointer/howto-click-returns: a click inside the how-to screen's one
// box returns to the title.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch": "`howto` and `chest` show no menu, and each answers the pointer
// and touch on one rectangle instead: the area the screen's way out is taken in
// ... taking it does what `back` on `howto` and `confirm` on `chest` do", and
// rule 2: "On `howto` the one rectangle carries no `confirm`, so a press and
// release inside it does exactly what `back` there does." `specs/ui.md`,
// "`howto`": "`back` returns to `title` with `HOW TO PLAY` selected."
//
// WHY THIS IS ITS OWN POINT. Without it a player on a pointing device can reach
// How To Play from the title, which answers the pointer, and has no way back.
// The keyboard's route is `screens/howto-back-returns`'.
//
// WHAT IS READ. The screen and the highlight after the click. A build that
// answered nothing stays on `howto`; one that answered but returned to the wrong
// entry differs on the highlight.
//
// THE DRIVE. `setScreen("howto")`, the box read back off `menuRects`, and a
// click at the middle of it.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickRect,
  createHarness,
  menuRects,
  poseScreen,
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

it("returns to the title with HOW TO PLAY selected when the box is clicked", async () => {
  h.reset();
  const howto = poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "the screen the click is made on");

  const rects = menuRects(h);
  assertLength(rects, 1, "the how-to screen's one box (specs/controls.md)");

  const after = await clickRect(h, rects[0]);
  captureStill(h, "returned");

  assertEqual(after.screen, "title", "the screen the click left");
  assertEqual(
    after.menuIndex,
    HOW_TO_PLAY,
    "the title entry selected on returning from the how-to screen",
  );
});
