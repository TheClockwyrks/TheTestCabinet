// instrumentation/snapshot-reports-almanac-tab — on `almanac`, `almanacTab`
// reads the tab the screen shows.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "Snapshot shape":
// "`almanacTab`: the tab the almanac is showing", "beside `menuIndex`, outside
// `run`". specs/ui.md (`almanac`) fixes what it holds: "`menuIndex`,
// `almanacTab`, and `almanacScroll` are `0` on arriving", and "`left` and
// `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends".
// `almanacScroll` is `instrumentation/snapshot-reports-almanac-scroll`'s.
//
// THE DRIVE. The almanac is reached through `setScreen`, and then posed with a
// real key edge, because no operation of the surface sets the field: what the
// almanac HOLDS is the only thing it can be read off. What the key press is
// WORTH belongs to the screens points about the almanac's navigation; what this
// decides is that the field reports the position back.
//
// THE TOLERANCE is exactness: the field is a whole index the specification
// names, not a measured figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the almanac's tab back", async () => {
  const entered = poseScene(h, "almanac");
  assertEqual(entered.almanacTab, 0, "almanacTab on arriving");

  const moved = await tap(h, "ArrowRight");
  await h.tick(1);
  captureStill(h, "tab");

  assertEqual(moved.almanacTab, 1, "almanacTab after one right");
});
