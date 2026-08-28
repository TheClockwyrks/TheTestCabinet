// Refract — screens/title-down-wraps: down wraps from the last title item to
// the first.
//
// specs/ui.md: `up` and `down` move the highlight by one item and wrap at both
// ends. This is the lower end: on the title with menuIndex 2, one down press
// lands back on 0. The last item is reached by two ordinary down presses —
// the single-step move is its own review item — and the arrival is asserted
// before the wrap, so a build whose stepping is broken fails on the pose it
// missed rather than on a wrap it never attempted.

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
  await tapAction(h, "down");
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    2,
    "posing: two downs put the highlight on the last item (specs/ui.md)",
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
