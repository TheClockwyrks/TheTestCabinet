// Wick — instrumentation/menu-rects-empty-on-playing: `menuRects()` reports an
// empty list on `playing`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `menuRects()`):
// "`playing` reports an empty list." specs/controls.md ("The pointer and
// touch") names the screens that do answer a gesture — the six that show a
// vertical menu, plus `howto` and `chest` on one box each — and closes with
// "`playing` answers neither", which is the one screen this sweeps.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night, entered the real way, so
// the reading is taken over a run rather than over a posed screen name. The
// screen is read back first, so an empty list from a build that never left
// `title` is not read as a pass. That `howto` and `chest` report their one box
// each is `menu-rects-one-box-without-menu`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { RECTLESS_SCREENS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  menuRects,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no rectangles on the run screen", async () => {
  for (const screen of RECTLESS_SCREENS) {
    await isolate(h);
    const standing = await h.snapshot();
    assertEqual(standing.screen, screen, "the screen the reading is taken on");
    assertLength(await menuRects(h), 0, `menuRects() on ${screen}`);
  }
  await captureStill(h, "empty");
});
