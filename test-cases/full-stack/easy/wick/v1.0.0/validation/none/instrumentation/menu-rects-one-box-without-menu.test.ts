// Wick — instrumentation/menu-rects-one-box-without-menu: `menuRects()` reports
// exactly one rectangle on `howto` and on `chest`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `menuRects()`):
// "`howto` and `chest` report exactly one rectangle, the area the screen's way
// out is taken in." specs/controls.md ("The pointer and touch") says the same
// from the rules' side: "`howto` and `chest` show no menu, and each answers the
// pointer and touch on one rectangle instead ... It is that screen's rectangle
// at position `0`."
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The length of the reported list on
// each of the two, and that the rectangle sits on the stage with a positive
// extent — a box of no width answers no gesture, so a build reporting one would
// satisfy the count and leave a touch player stuck. What the box DOES is the
// Pointer category's; that it exists at all is the reading this decides.
//
// WHY THE WORLD IS POSED AS IT IS. Each screen is entered by its own real
// route: `howto` through its `setScreen` row, and `chest` through
// "`spawnPickup("chest", x, y)` at the lamplighter's center and one tick, which
// is the real collection path", so the overlay stands over a run that was
// played. The screen is read back before each reading.
//
// THE TOLERANCE. None: a count, and an extent that is above zero or is not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThan,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  menuRects,
  openChest,
  poseScreen,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports one box on howto and one on chest", async () => {
  await poseScreen(h, "howto");
  const onHowto = await h.snapshot();
  assertEqual(onHowto.screen, "howto", "the screen the first reading is on");
  const howtoRects = await menuRects(h);
  assertLength(howtoRects, 1, "menuRects() on howto");

  await isolate(h);
  const opened = await openChest(h);
  await captureStill(h, "boxes");
  assertEqual(opened.screen, "chest", "the screen the second reading is on");
  const chestRects = await menuRects(h);
  assertLength(chestRects, 1, "menuRects() on chest");

  for (const [screen, rect] of [
    ["howto", howtoRects[0]!],
    ["chest", chestRects[0]!],
  ] as const) {
    assertGreaterThan(rect.width, 0, `the width of the box on ${screen}`);
    assertGreaterThan(rect.height, 0, `the height of the box on ${screen}`);
    assertGreaterThan(
      rect.x + rect.width,
      0,
      `the right edge of the box on ${screen}, on the stage`,
    );
    assertLessThan(
      rect.x,
      STAGE_W,
      `the left edge of the box on ${screen}, on the stage`,
    );
    assertGreaterThan(
      rect.y + rect.height,
      0,
      `the bottom edge of the box on ${screen}, on the stage`,
    );
    assertLessThan(
      rect.y,
      STAGE_H,
      `the top edge of the box on ${screen}, on the stage`,
    );
  }
});
