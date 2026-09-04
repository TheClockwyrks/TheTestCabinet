// screens/almanac-confirm-inert — confirm does nothing on the almanac.
//
// WHAT THIS DECIDES. One thing: a `confirm` press on `almanac` leaves the
// screen, the entry highlight, the tab and the list's window exactly as they
// were, so no entry of the almanac is an item that can be taken.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`confirm` and `pause` do nothing here."
//   specs/controls.md ("What each screen reads"): the `almanac` row lists
//   `up`, `down`, `left`, `right`, `back`, and `mute`, and no `confirm`.
//   specs/controls.md ("Actions and bindings"): `confirm` is `Enter`, `Space`.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then the tab bar and
// the list are both walked away from where the screen opened, so the reading is
// taken on a state a build that resets something on `confirm` would visibly
// disturb; a check pressing `Enter` on the opening state would pass such a
// build for free. Then one `Enter` over one frame.
//
// THE TOLERANCE. None: a screen name and three indices are exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { DOWN_KEY, RIGHT_KEY, tapTimes } from "./almanac";

let h: Harness;

/** A tab away from the first, and an entry past the window the list shows. */
const TAB_MOVES = 2;
const WALKED = ALMANAC_ROWS + 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the screen, the tab, the entry, and the window untouched", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the keys are pressed on");

  await tapTimes(h, RIGHT_KEY, TAB_MOVES);
  const staged = await tapTimes(h, DOWN_KEY, WALKED);
  assertEqual(staged.almanacTab, TAB_MOVES, "the tab Enter is pressed on");
  assertEqual(staged.menuIndex, WALKED, "the entry Enter is pressed on");
  assertGreaterThan(
    staged.almanacScroll,
    0,
    "the list's first row Enter is pressed at",
  );

  const after = await tap(h, "Enter");
  captureStill(h, "inert");

  assertEqual(after.screen, "almanac", "the screen Enter left the game on");
  assertEqual(after.almanacTab, staged.almanacTab, "the tab after Enter");
  assertEqual(after.menuIndex, staged.menuIndex, "the entry after Enter");
  assertEqual(
    after.almanacScroll,
    staged.almanacScroll,
    "the list's first row after Enter",
  );
});
