// pointer/howto-click-returns — a click inside the how-to screen's one box
// returns to the title.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"):
// "`howto` and `chest` show no menu, and each answers the pointer and touch on
// one rectangle instead: the area the screen's way out is taken in ... taking it
// does what `back` on `howto` and `confirm` on `chest` do", and rule 2 adds "On
// `howto` the one rectangle carries no `confirm`, so a press and release inside
// it does exactly what `back` there does." specs/ui.md ("`howto`"): "`back`
// returns to `title` with `HOW TO PLAY` selected."
//
// WHY THIS IS A POINT OF ITS OWN. Without it a player on a pointing device can
// reach How To Play from the title, which answers the pointer, and has no way
// back. The keyboard's route is `screens/howto-back-returns`'; this decides the
// pointer's.
//
// HOW THE SCENARIO IS DRIVEN. `setScreen("howto")` stands the game there, the
// build reports where it drew the box, and the primary button is pressed and
// released at the middle of it. No stage point is named by the check, because
// the specification fixes no layout.
//
// THE TOLERANCE. None: a screen name and a menu index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, clickAt, createHarness, type Harness } from "../harness";
import { howtoPoint } from "./stage";

/** The entry `back` on the how-to screen returns to. */
const HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with HOW TO PLAY selected when the box is clicked", async () => {
  const at = await howtoPoint(h);

  const left = await clickAt(h, at);
  await captureStill(h, "returned");

  assertEqual(left.screen, "title", "the screen the click left");
  assertEqual(
    left.menuIndex,
    HOW_TO_PLAY,
    "the title entry selected on returning from the how-to screen",
  );
});
