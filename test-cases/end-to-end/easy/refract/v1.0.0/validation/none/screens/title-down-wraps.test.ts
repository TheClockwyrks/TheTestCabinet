// Refract — screens/title-down-wraps: one down press on the last title item
// wraps the selection back to the first.
//
// specs/ui.md: `up` and `down` move the highlight by one item "and wrap at both
// ends". The last item is posed by two plain down presses from the arrival
// index — never by the up-wrap, so this check does not lean on the other wrap it
// is the sibling of. The wrapping press itself is a real key, so what is graded
// is the build's own wrap handling behind the `down` action.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  type Harness,
} from "../harness";
import { poseLastTitleItem } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wraps menuIndex from 2 to 0 with one down press", async () => {
  await poseLastTitleItem(h);

  await fireAction(h, "down");
  await captureStill(h, "menu");

  const wrapped = await h.snapshot();
  assertEqual(wrapped.screen, "title", "the wrap stays on the title");
  assertEqual(
    wrapped.menuIndex,
    0,
    "one down press from the last item wraps to the first",
  );
});
