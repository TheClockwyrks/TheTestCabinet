// pointer/howto-touch-returns — a touch contact landing and lifting inside the
// how-to screen's one box returns to the title.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: "A touch contact landing inside a rectangle is that rectangle's press
// edge and lifting is its release edge, so a contact landing and lifting inside
// the rectangle of the item at `menuIndex` `i` selects that item and takes it
// exactly as `confirm` on it does", with the screen's own paragraph fixing that
// taking `howto`'s one box "does what `back` on `howto` ... does".
// specs/ui.md ("`howto`"): "`back` returns to `title` with `HOW TO PLAY`
// selected."
//
// WHY THIS IS A POINT OF ITS OWN. specs/ui.md ("Menu navigation") has every
// screen left "by the keyboard, the pointer, and touch alike". A player on a
// touch device can reach How To Play from the title, which answers a contact,
// so a build that answers no contact here strands them; the mouse's route is
// `pointer/howto-click-returns`'.
//
// HOW THE SCENARIO IS DRIVEN. A REAL contact through Chromium's touch pipeline,
// landing at the middle of the box the build reported and lifting in the same
// place, one driven frame each. The two are separate frames because the landing
// and the lift are separately observable.
//
// THE TOLERANCE. None: a screen name and a menu index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  touchTapAt,
  type Harness,
} from "../harness";
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

it("returns to the title with HOW TO PLAY selected when the box is tapped", async () => {
  const at = await howtoPoint(h);

  const left = await touchTapAt(h, at);
  await captureStill(h, "returned");

  assertEqual(left.screen, "title", "the screen the contact left");
  assertEqual(
    left.menuIndex,
    HOW_TO_PLAY,
    "the title entry selected on returning from the how-to screen",
  );
});
