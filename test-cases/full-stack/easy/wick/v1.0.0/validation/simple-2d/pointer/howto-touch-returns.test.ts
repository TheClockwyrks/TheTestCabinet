// pointer/howto-touch-returns — a contact landing and lifting inside the how-to
// screen's one box returns to the title.
//
// WHAT THIS DECIDES. One thing: a touch contact reaches `howto`'s one box, so a
// player on a touch device has a way off the screen.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 3: "A touch contact landing
//   inside a rectangle is that rectangle's press edge and lifting is its release
//   edge, so a contact landing and lifting inside the rectangle ... takes it
//   exactly as `confirm` on it does", with the screen's own paragraph fixing
//   that taking `howto`'s box "does what `back` on `howto` ... does".
//   specs/ui.md (`howto`): "`back` returns to `title` with `HOW TO PLAY`
//   selected."
//   specs/ui.md (Menu navigation): `howto` and `chest` "each is left by the
//   keyboard, the pointer, and touch alike".
//
// THE DRIVE. `setScreen("howto")`, the box read back off `menuRects`, and a
// contact landing at the middle of it and lifting there, a frame each. The
// events are the ones a finger produces: a `pointerdown` naming `touch` with no
// move before it, and a `pointerup` naming `touch`.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  touchTapRect,
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

it("returns to the title with HOW TO PLAY selected when the box is tapped", async () => {
  const before = poseScene(h, "howto");
  assertEqual(before.screen, "howto", "the screen the contact lands on");

  const rect = menuRectAt(h, 0, "the how-to screen's one box");
  const after = await touchTapRect(h, rect);
  captureStill(h, "returned");

  assertEqual(after.screen, "title", "the screen the contact left the game on");
  assertEqual(
    after.menuIndex,
    HOW_TO_PLAY,
    "the title entry selected on returning from the how-to screen",
  );
});
