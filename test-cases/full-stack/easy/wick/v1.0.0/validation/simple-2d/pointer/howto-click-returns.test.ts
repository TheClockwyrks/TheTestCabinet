// pointer/howto-click-returns — a click inside the how-to screen's one box
// returns to the title.
//
// WHAT THIS DECIDES. One thing: a press and release inside the box `howto`
// reports leaves the game on `title` with `HOW TO PLAY` selected, so a pointing
// device has a way off the screen.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch): "`howto` and `chest` show no
//   menu, and each answers the pointer and touch on one rectangle instead: the
//   area the screen's way out is taken in ... taking it does what `back` on
//   `howto` and `confirm` on `chest` do", and rule 2: "On `howto` the one
//   rectangle carries no `confirm`, so a press and release inside it does
//   exactly what `back` there does."
//   specs/ui.md (`howto`): "`back` returns to `title` with `HOW TO PLAY`
//   selected."
//
// WHY IT IS A POINT OF ITS OWN. Without it a player on a pointing device can
// reach How To Play from the title, which answers the pointer, and has no way
// back. The keyboard's route is `screens/howto-back-returns`'.
//
// THE DRIVE. `setScreen("howto")`, the box read back off `menuRects`, and a
// click at the middle of it.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickRect,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

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
  const before = poseScene(h, "howto");
  assertEqual(before.screen, "howto", "the screen the click lands on");

  const rect = menuRectAt(h, 0, "the how-to screen's one box");
  const after = await clickRect(h, rect);
  captureStill(h, "returned");

  assertEqual(after.screen, "title", "the screen the click left the game on");
  assertEqual(
    after.menuIndex,
    HOW_TO_PLAY,
    "the title entry selected on returning from the how-to screen",
  );
});
