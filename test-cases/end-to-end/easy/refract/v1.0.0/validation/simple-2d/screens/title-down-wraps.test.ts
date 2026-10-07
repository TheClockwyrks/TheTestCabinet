// Refract — screens/title-down-wraps: down wraps from the last title item to
// the first.
//
// specs/ui.md: `up` and `down` move the highlight by one item and wrap at both
// ends. This is the lower end: on the title with menuIndex 2, one down press
// lands back on 0. The highlight is POSED onto the last item with
// `setMenuIndex` — the single-step move is `screens/title-down`'s own review
// item, and a build that cannot step must still be graded on whether it
// wraps.

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

it("one down press at menuIndex 2 wraps to 0, the first item", async () => {
  await resetTo(h);
  h.debug.setMenuIndex(2);
  await h.advance(1);
  assertEqual(
    h.snapshot().menuIndex,
    2,
    "posing: the highlight sits on the last title item (specs/ui.md)",
  );

  await tapAction(h, "down");
  captureStill(h, "menu");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "title",
    "down moves the highlight and leaves the screen (specs/ui.md)",
  );
  assertEqual(
    snapshot.menuIndex,
    0,
    "down at the last item wraps to the first (specs/ui.md)",
  );
});
