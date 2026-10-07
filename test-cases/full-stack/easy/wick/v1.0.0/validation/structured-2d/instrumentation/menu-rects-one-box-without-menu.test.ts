// Wick — instrumentation/menu-rects-one-box-without-menu: `menuRects()` reports
// exactly one rectangle on `howto` and on `chest`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Menus", `menuRects()`: "`howto` and `chest` report exactly one rectangle,
// the area the screen's way out is taken in." `specs/controls.md`, "The pointer
// and touch", says the same from the rules' side: "`howto` and `chest` show no
// menu, and each answers the pointer and touch on one rectangle instead ... It
// is that screen's rectangle at position `0`."
//
// WHAT IS READ, AND WHY. The length of the list on each of the two, and that
// the box has a positive extent lying on the stage: a box of no width answers
// no gesture, so a build reporting one would satisfy the count and still leave a
// player with no way out. What the box DOES is the Pointer category's.
//
// THE DRIVE. `setScreen("howto")` from the title, and the chest overlay opened
// the real way — a chest pickup at the lamplighter's center and the one tick
// that collects it, which `specs/instrumentation.md` names as the collection
// path.
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
import type { WickRect } from "../harness";

/** The box lies on the stage with an area a finger can land in. */
function assertUsable(rect: WickRect, screen: string): void {
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports one usable box on howto and one on chest", async () => {
  h.reset();
  const howto = poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "screen reached for howto");
  const onHowto = menuRects(h);
  assertLength(onHowto, 1, "menuRects() on howto");
  assertUsable(onHowto[0], "howto");

  isolate(h);
  const chest = await openChest(h);
  await h.frameDraw();
  captureStill(h, "boxes");
  assertEqual(chest.screen, "chest", "screen reached for chest");
  const onChest = menuRects(h);
  assertLength(onChest, 1, "menuRects() on chest");
  assertUsable(onChest[0], "chest");
});
