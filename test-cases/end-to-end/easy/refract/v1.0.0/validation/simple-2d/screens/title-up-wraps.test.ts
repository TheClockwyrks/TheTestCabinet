// Refract — screens/title-up-wraps: up wraps from the first title item to the
// last.
//
// specs/ui.md: `up` and `down` move the highlight by one item and wrap at both
// ends. This is the upper end: on the title with menuIndex 0, one up press
// lands on 2, the last of the three TITLE_ITEMS. The press is a real key event
// through the `up` binding, and the result is read off the game's own state.

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

it("one up press at menuIndex 0 wraps to 2, the last item", async () => {
  await resetTo(h);
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "posing: menuIndex is 0 on arriving at the title (specs/ui.md)",
  );

  await tapAction(h, "up");
  captureStill(h, "menu");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "title",
    "up moves the highlight and leaves the screen (specs/ui.md)",
  );
  assertEqual(
    snapshot.menuIndex,
    2,
    "up at the first item wraps to the last (specs/ui.md)",
  );
});
