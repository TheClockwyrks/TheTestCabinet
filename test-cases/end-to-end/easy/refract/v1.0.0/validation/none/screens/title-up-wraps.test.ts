// Refract — screens/title-up-wraps: one up press on the first title item wraps
// the selection to the last.
//
// specs/ui.md: `up` and `down` move the highlight by one item "and wrap at both
// ends", and `menuIndex` is 0 on arrival — so from the top, one up press lands
// on `TITLE_ITEMS[2]`, index 2. The press is a real key, so what is graded is
// the build's own wrap handling behind the `up` action.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps menuIndex from 0 to 2 with one up press", async () => {
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title");
  assertEqual(opened.menuIndex, 0, "menuIndex is 0 on arriving at the title");

  await fireAction(h, "up");
  await captureStill(h, "menu");

  const wrapped = await h.snapshot();
  assertEqual(wrapped.screen, "title", "the wrap stays on the title");
  assertEqual(
    wrapped.menuIndex,
    2,
    "one up press from 0 wraps to the last item",
  );
});
