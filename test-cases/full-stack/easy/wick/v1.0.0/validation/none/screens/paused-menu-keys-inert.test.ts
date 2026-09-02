// screens/paused-menu-keys-inert — `up`, `down` and `confirm` do nothing on the
// pause screen.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`paused`"): "`up`, `down`, and
// `confirm` do nothing here." specs/controls.md ("What each screen reads"), the
// `paused` row, names `pause`, `back` and `mute` alone, and "An action a row
// omits does nothing on that screen." specs/ui.md ("Menu navigation"):
// "`menuIndex` is `0` on entering every screen, and on a screen with no
// highlight it stays `0`."
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated and paused, and then
// all three keys are pressed in turn, each a REAL key through Chromium's input
// pipeline held across exactly one frame, with the screen and the index read
// after each: three presses that each do nothing are three chances for a build
// that wired a menu here to be caught, and reading after each says which one
// moved. `confirm` is pressed last, because a build that treated it as a menu
// acceptance would act on whatever index the arrows left.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressConfirm,
  pressDown,
  pressPause,
  pressUp,
  type Harness,
} from "../harness";
import { assertHighlight, night } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves paused with menuIndex 0 under ArrowUp, ArrowDown and Enter", async () => {
  await night(h);
  const held = await pressPause(h);
  assertEqual(held.screen, "paused", "the screen the presses are made on");
  assertEqual(held.menuIndex, 0, "menuIndex on arriving at paused");

  const afterUp = await pressUp(h);
  assertHighlight(afterUp, "paused", 0, "after ArrowUp on the pause screen");
  const afterDown = await pressDown(h);
  assertHighlight(
    afterDown,
    "paused",
    0,
    "after ArrowDown on the pause screen",
  );
  const afterConfirm = await pressConfirm(h);
  await captureStill(h, "inert");

  assertHighlight(afterConfirm, "paused", 0, "after Enter on the pause screen");
});
