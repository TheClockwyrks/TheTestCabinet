// Refract — screens/howto-back: back leaves the how-to screen for the title.
//
// specs/ui.md's `howto` section: `back` returns to `title` with
// `menuIndex = 0`. The how-to screen is reached the way a player reaches it —
// two downs and a confirm from the fresh title — and the arrival is asserted
// before the back, so a build that never opened the screen fails on the pose
// rather than on a return it never made. The still is the title the back left.

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

it("back on the how-to screen returns to title with menuIndex 0", async () => {
  await resetTo(h);
  await tapAction(h, "down");
  await tapAction(h, "down");
  await tapAction(h, "confirm");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: confirming HOW TO PLAY opens the how-to screen (specs/ui.md)",
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
    0,
    "back returns with menuIndex 0 (specs/ui.md)",
  );
});
