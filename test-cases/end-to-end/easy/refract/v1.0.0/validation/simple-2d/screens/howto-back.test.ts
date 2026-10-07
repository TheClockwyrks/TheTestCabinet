// Refract — screens/howto-back: back leaves the how-to screen for the title.
//
// specs/ui.md's `howto` section: `back` returns to `title` with `HOW TO PLAY`
// highlighted (`menuIndex = 2`). The how-to screen is POSED with `setScreen`
// rather than walked to through the title menu, so a build with a broken `down`
// binding fails `screens/title-down` and passes this point; the arrival is
// asserted before the back, so a build that could not be posed onto the screen
// fails on the pose rather than on a return it never made. The still is the
// title the back left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("back on the how-to screen returns to title with menuIndex 2", async () => {
  await resetTo(h);
  h.debug.setScreen("howto");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: the how-to screen is up (specs/instrumentation.md setScreen)",
  );

  await tapAction(h, "back");
  captureStill(h, "title");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "title",
    "back returns to the title (specs/ui.md)",
  );
  assertEqual(
    snapshot.menuIndex,
    2,
    "back returns with HOW TO PLAY highlighted, menuIndex 2 (specs/ui.md)",
  );
});
