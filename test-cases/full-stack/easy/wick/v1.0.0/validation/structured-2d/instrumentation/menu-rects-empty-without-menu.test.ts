// Wick — instrumentation/menu-rects-empty-without-menu: `menuRects()` reports
// an empty list on a screen that carries no menu.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Menus", `menuRects()`: "`howto`, `playing`, and `chest` report an empty
// list." `specs/ui.md` gives those three no menu: `howto` is copy and `back`,
// `playing` is the run, and `chest` shows one result and closes on `confirm`.
//
// WHAT IS READ, AND WHY. The length of the reported list on each of the three.
// A build that reported the rectangles of whatever menu it drew last, or that
// answered the pointer on a screen with nothing to select, is caught by a
// non-empty reading here.
//
// THE DRIVE. `setScreen("howto")` from the title, an isolated `playing` run,
// and the chest overlay opened the real way — a chest pickup at the
// lamplighter's center and the one tick that collects it, which
// `specs/instrumentation.md` names as the collection path.
//
// THE TOLERANCE. None: a list is empty or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
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

afterEach(() => {
  h.dispose();
});

it("reports no rectangles on howto, playing, and chest", async () => {
  h.reset();
  const howto = poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "screen reached for howto");
  assertLength(menuRects(h), 0, "menuRects() on howto");

  const playing = isolate(h);
  assertEqual(playing.screen, "playing", "screen reached for playing");
  assertLength(menuRects(h), 0, "menuRects() on playing");

  const chest = await openChest(h);
  await h.frameDraw();
  captureStill(h, "empty");
  assertEqual(chest.screen, "chest", "screen reached for chest");
  assertLength(menuRects(h), 0, "menuRects() on chest");
});
